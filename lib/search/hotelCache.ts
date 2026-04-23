// ─── Hotel search cache (in-process, per-instance) ────────────────────────────
// Mirror of flightCache.ts — caches the broad, unfiltered aggregate from
// aggregateHotels() keyed on hard constraints only so many filter permutations
// share a single LiteAPI fetch within the TTL.
//
// Rollback: set FLEXE_HOTEL_CACHE=off in Railway to disable caching.

import type { HotelSearchParams, NormalizedHotel } from './types';

// ─── Tunables ─────────────────────────────────────────────────────────────────
// LiteAPI prices + availability are more stable than flight offers, so a
// slightly longer TTL pays off. Still short enough that rate changes surface
// before the user commits to checkout (prebook re-validates anyway).
const TTL_MS      = 120_000;   // 2 minutes
const MAX_ENTRIES = 500;

// ─── Storage ──────────────────────────────────────────────────────────────────
interface CacheValue {
  hotels:           NormalizedHotel[];
  sources:          string[];
  errors:           string[];
  isSample:         boolean;
  noResultsMessage?: string;
  ts:               number;
}

const cache = new Map<string, CacheValue>();

let hitCount   = 0;
let missCount  = 0;
let storeCount = 0;
let evictCount = 0;

// ─── Key derivation — hard constraints only ──────────────────────────────────
// Destination names can come in mixed case from the model ("Cancún", "cancun",
// "CUN") — we lower-case and strip diacritics for robust key normalisation.

function normalizeDestination(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function makeKey(p: HotelSearchParams): string {
  return JSON.stringify({
    d:  normalizeDestination(p.destination),
    ci: p.checkIn  ?? '',
    co: p.checkOut ?? '',
    a:  p.adults   ?? 1,
    c:  (p.childrenAges ?? []).slice().sort((a, b) => a - b),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isHotelCacheEnabled(): boolean {
  return process.env.FLEXE_HOTEL_CACHE !== 'off';
}

export function lookupHotelCache(
  params: HotelSearchParams,
): Omit<CacheValue, 'ts'> | null {
  if (!isHotelCacheEnabled()) return null;

  const key   = makeKey(params);
  const entry = cache.get(key);

  if (!entry) {
    missCount++;
    return null;
  }
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    missCount++;
    return null;
  }

  hitCount++;
  const { ts: _ts, ...rest } = entry;
  return rest;
}

export function storeHotelCache(
  params: HotelSearchParams,
  value: Omit<CacheValue, 'ts'>,
): void {
  if (!isHotelCacheEnabled()) return;

  // Don't cache pure-sample fallbacks — we want to keep retrying LiteAPI.
  if (value.isSample) return;
  // Don't cache empty results — transient LiteAPI hiccups shouldn't persist.
  if (value.hotels.length === 0) return;

  const key = makeKey(params);
  cache.set(key, { ...value, ts: Date.now() });
  storeCount++;

  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs  = Infinity;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) {
      cache.delete(oldestKey);
      evictCount++;
    }
  }
}

export interface HotelCacheStats {
  enabled:   boolean;
  size:      number;
  maxSize:   number;
  ttlMs:     number;
  hits:      number;
  misses:    number;
  stores:    number;
  evictions: number;
  hitRate:   number | null;
}

export function getHotelCacheStats(): HotelCacheStats {
  const total = hitCount + missCount;
  return {
    enabled:   isHotelCacheEnabled(),
    size:      cache.size,
    maxSize:   MAX_ENTRIES,
    ttlMs:     TTL_MS,
    hits:      hitCount,
    misses:    missCount,
    stores:    storeCount,
    evictions: evictCount,
    hitRate:   total > 0 ? hitCount / total : null,
  };
}

/** Tests only. */
export function resetHotelCache(): void {
  cache.clear();
  hitCount = missCount = storeCount = evictCount = 0;
}
