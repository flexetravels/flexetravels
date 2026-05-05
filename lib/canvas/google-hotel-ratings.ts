// ─── Google Places hotel rating enrichment ──────────────────────────────────
// LiteAPI's hotel rates response doesn't carry guest scores — `reviewCount`
// is empty and `rating` is the synthetic "stars-derived" baseline we compute
// in liteapi.ts. Google Places, by contrast, has near-universal coverage of
// branded + independent hotels with real review-count + 0–5 ratings.
//
// This helper batches Places Text Search lookups (one per hotel) with bounded
// concurrency, caches each result for 24h, and is non-blocking by design:
// callers race it against a wall-clock cap and fall back to the synthetic
// baseline when Places times out or returns nothing.
//
// Soft-fails (returns empty map) when GOOGLE_PLACES_API_KEY is missing — so
// adding this helper is zero-risk to existing hotel search performance.

const TTL_MS      = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const PLACES_HOST = 'https://places.googleapis.com';

// Concurrency cap on outbound Places calls per enrichment batch. 5 is plenty
// for a typical 10-result hotel list and keeps quota use predictable.
const MAX_CONCURRENT = 5;

export interface GoogleHotelRating {
  googleRating:      number;     // 0–5 from Places
  googleRatingCount: number;
}

interface CacheValue extends GoogleHotelRating { ts: number }

const cache = new Map<string, CacheValue>();
let hitCount = 0, missCount = 0, storeCount = 0, errorCount = 0;

function cacheKey(name: string, city: string): string {
  return `${name.trim().toLowerCase()}|${city.trim().toLowerCase()}`;
}

function lookup(key: string): GoogleHotelRating | null {
  const e = cache.get(key);
  if (!e) { missCount++; return null; }
  if (Date.now() - e.ts > TTL_MS) {
    cache.delete(key);
    missCount++;
    return null;
  }
  hitCount++;
  return { googleRating: e.googleRating, googleRatingCount: e.googleRatingCount };
}

function store(key: string, value: GoogleHotelRating): void {
  cache.set(key, { ...value, ts: Date.now() });
  storeCount++;
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs  = Infinity;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

interface PlacesPlace {
  rating?:          number;
  userRatingCount?: number;
}
interface PlacesSearchResponse { places?: PlacesPlace[] }

async function searchPlaceRating(
  name: string, city: string, apiKey: string,
): Promise<GoogleHotelRating | null> {
  let res: Response;
  try {
    res = await fetch(`${PLACES_HOST}/v1/places:searchText`, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': 'places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        textQuery:       `${name} ${city} hotel`,
        maxResultCount:  1,
        // Bias: hotels are 'lodging'. Improves match accuracy when a hotel
        // shares its name with a restaurant or street.
        includedType:    'lodging',
      }),
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    errorCount++;
    return null;
  }
  if (!res.ok) { errorCount++; return null; }

  const json = await res.json().catch(() => null) as PlacesSearchResponse | null;
  const p = json?.places?.[0];
  if (!p || typeof p.rating !== 'number' || typeof p.userRatingCount !== 'number') {
    return null;
  }
  return { googleRating: p.rating, googleRatingCount: p.userRatingCount };
}

// Run lookups with bounded concurrency. Returns Map<cacheKey, rating>.
export async function enrichHotelsWithGoogleRatings(
  hotels: Array<{ name: string; city: string }>,
): Promise<Map<string, GoogleHotelRating>> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const out = new Map<string, GoogleHotelRating>();
  if (!apiKey || apiKey.includes('PASTE')) return out;

  // Split into "served from cache" vs "needs lookup"
  const todo: Array<{ name: string; city: string; key: string }> = [];
  for (const h of hotels) {
    if (!h.name || !h.city) continue;
    const k = cacheKey(h.name, h.city);
    const cached = lookup(k);
    if (cached) out.set(k, cached);
    else        todo.push({ ...h, key: k });
  }
  if (todo.length === 0) return out;

  // Worker pool — process MAX_CONCURRENT lookups in parallel
  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const idx = cursor++;
      const t = todo[idx];
      const r = await searchPlaceRating(t.name, t.city, apiKey!);
      if (r) {
        store(t.key, r);
        out.set(t.key, r);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, todo.length) }, () => worker()),
  );
  return out;
}

// Convenience: same as enrichHotelsWithGoogleRatings but with a hard wall-clock
// cap. Returns whatever finished by the deadline. Used by the hotel aggregator
// to avoid letting a slow Places API balloon the search response time.
export async function enrichHotelsWithGoogleRatingsTimed(
  hotels:        Array<{ name: string; city: string }>,
  timeBudgetMs:  number,
): Promise<Map<string, GoogleHotelRating>> {
  return await Promise.race([
    enrichHotelsWithGoogleRatings(hotels),
    new Promise<Map<string, GoogleHotelRating>>(resolve =>
      setTimeout(() => resolve(new Map()), timeBudgetMs),
    ),
  ]);
}

export function getHotelRatingCacheStats() {
  return {
    placesConfigured: !!process.env.GOOGLE_PLACES_API_KEY,
    size:    cache.size,
    hits:    hitCount,
    misses:  missCount,
    stores:  storeCount,
    errors:  errorCount,
  };
}

// Used by the aggregator to look up a hotel's rating from a result map
// without re-deriving the cache key in the call site.
export function googleRatingKey(name: string, city: string): string {
  return cacheKey(name, city);
}
