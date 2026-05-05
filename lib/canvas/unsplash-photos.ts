// ─── Destination photo gallery fetcher (server-side) ────────────────────────
// Strategy:
//   1. Wikipedia REST summary → canonical landmark photo for the HERO. This
//      is the photo that says "you've arrived" for the city — Mt. Royal for
//      Montreal, Eiffel Tower for Paris, Mendenhall for Juneau, and so on.
//   2. Unsplash search → 6 GALLERY photos for variety. We disambiguate the
//      Unsplash query with the country/state from Wikipedia's description,
//      because a bare "Montreal" search returns generic skyscraper stock,
//      while "Montreal Quebec" returns actually-Montreal results.
//   3. If both fail → caller falls back to the themed gradient set.
//
// All in-memory cached for 24h via the same pattern as flightCache.ts.

import { fetchWikipediaInfo, extractLocationQualifier } from './wikipedia-photo';

const TTL_MS      = 24 * 60 * 60 * 1000;  // 24h — cities don't change
const MAX_ENTRIES = 500;

export interface DestinationPhotos {
  hero:    string;
  gallery: string[];
}

interface CacheValue extends DestinationPhotos {
  ts: number;
}

const cache = new Map<string, CacheValue>();

// Metrics (process-local; reset on deploy)
let hitCount   = 0;
let missCount  = 0;
let storeCount = 0;

function normalize(city: string): string {
  return city.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

function lookup(key: string): DestinationPhotos | null {
  const entry = cache.get(key);
  if (!entry) { missCount++; return null; }
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    missCount++;
    return null;
  }
  hitCount++;
  return { hero: entry.hero, gallery: entry.gallery };
}

function store(key: string, value: DestinationPhotos): void {
  cache.set(key, { ...value, ts: Date.now() });
  storeCount++;

  // O(n) LRU-ish eviction at cap; n=500 is fine
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs  = Infinity;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

interface UnsplashSearchResponse {
  results: Array<{
    id:           string;
    urls:         { raw: string; full: string; regular: string; small: string };
    description?: string | null;
    alt_description?: string | null;
  }>;
  total:       number;
  total_pages: number;
}

async function searchUnsplash(query: string, key: string): Promise<UnsplashSearchResponse | null> {
  try {
    const url =
      'https://api.unsplash.com/search/photos' +
      `?query=${encodeURIComponent(query)}` +
      `&orientation=landscape` +
      `&per_page=8` +
      `&content_filter=high`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
      signal:  AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    return await res.json() as UnsplashSearchResponse;
  } catch {
    return null;
  }
}

// Unsplash recommends appending sizing params to urls.raw rather than using
// a fixed pre-rendered size. `auto=format` lets their CDN serve AVIF/WebP.
function sized(rawUrl: string, w: number): string {
  const sep = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${sep}w=${w}&q=80&fit=crop&auto=format`;
}

// Wikipedia photos come from upload.wikimedia.org and aren't size-templated
// the same way Unsplash is. The /thumb/ variants encode their target width
// in the path (`/640px-...jpg`). Wikimedia may reject generated thumbnail
// widths above the original image's native size with HTTP 400, so never
// upscale a thumbnail URL. Only downsize an existing thumb if it is larger
// than our target; otherwise keep the API-provided URL exactly as returned.
function resizeWikiThumb(url: string, w: number): string {
  const match = url.match(/\/(\d+)px-/i);
  if (!match) return url;
  const currentWidth = parseInt(match[1], 10);
  if (!Number.isFinite(currentWidth) || currentWidth <= w) return url;
  return url.replace(/\/(\d+)px-/i, `/${w}px-`);
}

export async function fetchDestinationPhotos(city: string): Promise<DestinationPhotos | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!city || city.trim().length < 2) return null;

  const cacheKey = normalize(city);
  const cached = lookup(cacheKey);
  if (cached) return cached;

  // Run Wikipedia + Unsplash in parallel. Either alone is enough to render
  // the leg, both is best.
  const wikiPromise = fetchWikipediaInfo(city);

  // Defer the Unsplash query until we know the location qualifier — running
  // the qualified search first means we don't waste a request on the
  // generic-results pass.
  const wiki = await wikiPromise;
  const qualifier = extractLocationQualifier(wiki.description);

  let unsplashResponse = key
    ? await searchUnsplash(qualifier ? `${city.trim()} ${qualifier}` : city.trim(), key)
    : null;

  // If qualified search came back too thin, retry with the bare city name.
  if (!unsplashResponse || unsplashResponse.results.length < 4) {
    if (key) {
      const broad = await searchUnsplash(city.trim(), key);
      if (broad && broad.results.length > (unsplashResponse?.results.length ?? 0)) {
        unsplashResponse = broad;
      }
    }
  }

  // Hero: prefer Wikipedia (canonical landmark), fall back to first Unsplash.
  const wikiHero = wiki.hero ? resizeWikiThumb(wiki.hero, 1600) : null;
  const firstUnsplashHero = unsplashResponse?.results[0]?.urls.raw
    ? sized(unsplashResponse.results[0].urls.raw, 1600)
    : null;
  const hero = wikiHero || firstUnsplashHero;

  // Gallery: Unsplash (for variety). If we used Unsplash for the hero, drop
  // its first result so the gallery doesn't duplicate it.
  const startIdx = wikiHero ? 0 : 1;
  const gallery  = (unsplashResponse?.results ?? [])
    .slice(startIdx, startIdx + 7)
    .map(r => sized(r.urls.raw, 800));

  if (!hero) return null;

  const photos: DestinationPhotos = { hero, gallery };
  store(cacheKey, photos);
  return photos;
}

// ─── Diagnostics — wired into /api/admin/stats if it exposes them later ─────

export function getPhotoCacheStats() {
  return {
    enabled: !!process.env.UNSPLASH_ACCESS_KEY,
    size:    cache.size,
    hits:    hitCount,
    misses:  missCount,
    stores:  storeCount,
  };
}
