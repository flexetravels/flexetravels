// ─── Live airport resolver via Duffel /places/suggestions ───────────────────
// Replaces the previous hand-curated CITY_TO_IATA table with an authoritative
// lookup against Duffel itself — the same provider we book through. Means
// any city/airport name Duffel knows is resolvable, and what we resolve to
// is exactly what subsequent flight searches accept.
//
// API: GET https://api.duffel.com/places/suggestions?query=<q>
// Auth: same DUFFEL_ACCESS_TOKEN we already have.
// Free, no rate limit issues at our scale (cached for 1h per query).

const TTL_MS      = 60 * 60 * 1000;     // 1h — airports do not change
const NEG_TTL_MS  = 5 * 60 * 1000;      // 5m for misses (let user retry sooner)
const MAX_ENTRIES = 500;
const TIMEOUT_MS  = 6_000;

export interface ResolvedPlace {
  /** 3-letter IATA code (city or airport). Used as the destination on flight searches. */
  iata:        string;
  /** "Halifax Stanfield International Airport" or "Halifax". */
  name:        string;
  /** When this was a city result, the city it represents — same as `name`. When
      it was an airport result, the city the airport serves. */
  cityName?:   string;
  /** ISO 3166-1 alpha-2 country code, e.g. "CA". */
  countryCode?: string;
  /** "city" | "airport" — useful for showing the right icon in autocompletes. */
  kind:        'city' | 'airport';
  /** Duffel's IATA city/metro code (e.g. NYC, MIL). When the result is an
      airport, this is its parent city; when it's a city, this matches `iata`. */
  iataCityCode?: string;
}

interface CacheValue {
  best:        ResolvedPlace | null;     // null = negative cache
  alternates?: ResolvedPlace[];
  ts:          number;
}

const cache = new Map<string, CacheValue>();

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function lookup(key: string): CacheValue | null {
  const v = cache.get(key);
  if (!v) return null;
  const isNeg = v.best === null;
  const ttl   = isNeg ? NEG_TTL_MS : TTL_MS;
  if (Date.now() - v.ts > ttl) { cache.delete(key); return null; }
  return v;
}

function store(key: string, value: Omit<CacheValue, 'ts'>): void {
  cache.set(key, { ...value, ts: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs  = Infinity;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

interface DuffelPlace {
  id?:               string;
  type?:             'airport' | 'city';
  name?:             string;
  iata_code?:        string;
  iata_city_code?:   string;
  iata_country_code?: string;
  city_name?:        string;
}

interface DuffelResponse {
  data?:   DuffelPlace[];
  errors?: Array<{ message?: string; title?: string }>;
}

async function callDuffel(query: string, token: string): Promise<DuffelPlace[] | null> {
  try {
    const url = `https://api.duffel.com/places/suggestions?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Duffel-Version': 'v2',
        'Accept':         'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as DuffelResponse;
    if (data.errors?.length) return null;
    return data.data ?? [];
  } catch {
    return null;
  }
}

function pickBest(places: DuffelPlace[]): ResolvedPlace | null {
  if (!places.length) return null;
  // Prefer city-level codes (e.g. NYC, YMQ, LON) when available — Duffel
  // searches the metro code as "any airport in that city" which is what
  // most users want when they type "Montreal" or "New York".
  const cities   = places.filter(p => p.type === 'city'   && p.iata_code);
  const airports = places.filter(p => p.type === 'airport' && p.iata_code);
  const top      = cities[0] ?? airports[0];
  if (!top || !top.iata_code) return null;
  return {
    iata:         top.iata_code.toUpperCase(),
    name:         top.name ?? top.iata_code,
    cityName:     top.city_name ?? top.name,
    countryCode:  top.iata_country_code,
    kind:         (top.type === 'airport' ? 'airport' : 'city') as 'city' | 'airport',
    iataCityCode: top.iata_city_code,
  };
}

function mapPlaces(places: DuffelPlace[]): ResolvedPlace[] {
  return places
    .filter(p => p.iata_code)
    .map(p => ({
      iata:         p.iata_code!.toUpperCase(),
      name:         p.name ?? p.iata_code!,
      cityName:     p.city_name ?? p.name,
      countryCode:  p.iata_country_code,
      kind:         (p.type === 'airport' ? 'airport' : 'city') as 'city' | 'airport',
      iataCityCode: p.iata_city_code,
    }))
    .slice(0, 10);
}

/**
 * Resolve a free-text query (city name, airport name, or 3-letter code) to a
 * single best Duffel place. Returns null when Duffel can't find a match,
 * which the caller should surface to the user as "type a more specific name".
 *
 * The 3-letter shortcut hits Duffel anyway so we end up with the canonical
 * name + country alongside the IATA code — useful for the autocomplete UX.
 */
export async function resolveAirport(query: string): Promise<ResolvedPlace | null> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token || !query) return null;

  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const cacheKey = normalize(trimmed);
  const cached = lookup(cacheKey);
  if (cached) return cached.best;

  const places = await callDuffel(trimmed, token);
  if (places === null) {
    // Network / API error — don't cache, retry next time
    return null;
  }
  const best = pickBest(places);
  store(cacheKey, { best, alternates: mapPlaces(places) });
  return best;
}

/**
 * Same as resolveAirport but returns up to 10 ranked suggestions. Used by
 * the AddLegDialog autocomplete so the user can pick the airport they
 * actually meant when there's ambiguity (e.g. "San Jose" → SJC, SJO, SJU).
 */
export async function resolveAirportSuggestions(query: string): Promise<ResolvedPlace[]> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token || !query || query.trim().length < 2) return [];

  const cacheKey = normalize(query);
  const cached = lookup(cacheKey);
  if (cached?.alternates) return cached.alternates;

  const places = await callDuffel(query.trim(), token);
  if (places === null) return [];
  const best = pickBest(places);
  const alternates = mapPlaces(places);
  store(cacheKey, { best, alternates });
  return alternates;
}
