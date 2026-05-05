// ─── Wikipedia summary fetcher (server-side) ────────────────────────────────
// The Wikipedia REST API returns the *canonical* landmark photo for any city
// or region — Montreal → Mt. Royal skyline, Paris → Eiffel Tower, Cabo →
// city collage. Use this for the leg hero so users get a photo of the actual
// place rather than whatever Unsplash random-search dredges up.
//
// Free, no API key. Wikimedia asks for a User-Agent identifying the app.
// Endpoint: GET /api/rest_v1/page/summary/{title}.

const TTL_MS      = 24 * 60 * 60 * 1000;     // 24h — Wikipedia hero rarely changes
const MAX_ENTRIES = 500;
const TIMEOUT_MS  = 6_000;

const USER_AGENT = 'FlexeTravels/1.0 (https://flexetravels.com; bookings@flexetravels.com)';

export interface WikipediaInfo {
  /** Canonical landmark / hero image URL — undefined if the page has none, or
      the page returned a non-photo (SVG map, locator marker, flag, etc.). */
  hero?: string;
  /** Short page description, e.g. "City in Jalisco, Mexico". Used to build a
      disambiguating query for Unsplash gallery search ("Cancun" vs
      "Cancun Quintana Roo Mexico"). */
  description?: string;
  /** Resolved Wikipedia title (after redirect resolution). */
  title?: string;
}

interface CacheValue extends WikipediaInfo {
  ts: number;
}

const cache = new Map<string, CacheValue>();

function normalize(city: string): string {
  return city.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

function lookup(key: string): WikipediaInfo | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { cache.delete(key); return null; }
  return { hero: entry.hero, description: entry.description, title: entry.title };
}

function store(key: string, value: WikipediaInfo): void {
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

interface RestSummary {
  type?:        string;        // 'standard' | 'disambiguation' | …
  title?:       string;
  description?: string;
  thumbnail?:   { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
}

async function fetchSummary(title: string): Promise<RestSummary | null> {
  try {
    const wikiTitle = title.trim().replace(/\s+/g, '_');
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json() as RestSummary;
  } catch {
    return null;
  }
}

// Some Wikipedia pages return a map / flag / locator marker as the page image.
// Filter those out — we only want actual photos.
function isPhotoUrl(url?: string): boolean {
  if (!url) return false;
  if (/\.svg(\?|$)/i.test(url)) return false;          // SVG maps / flags
  if (/special_marker|locator/i.test(url)) return false;
  if (/Flag_of/i.test(url)) return false;
  return true;
}

// "Largest city in Quebec, Canada" → "Quebec, Canada"
// "City in Jalisco, Mexico"        → "Jalisco, Mexico"
// "Capital and largest city of France" → "France"
// "Capital and most populous city in Japan" → "Japan"
export function extractLocationQualifier(description?: string): string | undefined {
  if (!description) return undefined;
  // Match `in <X>` or `of <X>` capturing up to the first sentence break
  const m = description.match(/\b(?:in|of)\s+([^.]+)/i);
  return m?.[1]?.trim();
}

// Wikipedia OpenSearch — returns ranked candidate titles for an ambiguous
// query. Used as the disambiguation fallback: "Halifax" alone is a disambig
// page, OpenSearch returns "Halifax, Nova Scotia" / "Halifax, West Yorkshire"
// which we then resolve in turn until one has a usable hero photo.
async function openSearchCandidates(query: string): Promise<string[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=8&namespace=0&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json() as [string, string[], string[], string[]];
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

export async function fetchWikipediaInfo(city: string): Promise<WikipediaInfo> {
  if (!city || city.trim().length < 2) return {};

  const cacheKey = normalize(city);
  const cached = lookup(cacheKey);
  if (cached) return cached;

  // Try a sequence of titles in order; stop at the first one with a usable
  // photo. Each stage handles a different failure mode:
  //
  //   1. exact name             — works for unambiguous titles ("Paris", "Tokyo")
  //   2. "<name>, <state/country>" via OpenSearch — handles disambiguations
  //      ("Halifax" → "Halifax, Nova Scotia")
  //   3. "<name> City"          — covers "New York" → "New York City" etc.
  const candidates: string[] = [city];

  const initial = await fetchSummary(city);
  let chosen = initial;
  let chosenHero = initial?.originalimage?.source ?? initial?.thumbnail?.source;

  // If the initial result is a disambig OR has no photo, query OpenSearch
  // for ranked alternatives and try them in order.
  if (initial?.type === 'disambiguation' || !isPhotoUrl(chosenHero)) {
    const alt = await openSearchCandidates(city);
    for (const title of alt) {
      if (candidates.includes(title)) continue;
      candidates.push(title);
      const s = await fetchSummary(title);
      const h = s?.originalimage?.source ?? s?.thumbnail?.source;
      if (s && s.type !== 'disambiguation' && isPhotoUrl(h)) {
        chosen = s;
        chosenHero = h;
        break;
      }
    }
  }

  // Final desperation: try "<name> City"
  if (!isPhotoUrl(chosenHero)) {
    const retry = await fetchSummary(`${city} City`);
    const retryHero = retry?.originalimage?.source ?? retry?.thumbnail?.source;
    if (retry && isPhotoUrl(retryHero)) {
      chosen = retry;
      chosenHero = retryHero;
    }
  }

  const result: WikipediaInfo = {
    hero:        isPhotoUrl(chosenHero) ? chosenHero : undefined,
    description: chosen?.description,
    title:       chosen?.title,
  };

  store(cacheKey, result);
  return result;
}
