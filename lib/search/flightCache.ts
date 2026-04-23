// ─── Flight search cache (in-process, per-instance) ───────────────────────────
// Caches normalized flight results from aggregateFlights() keyed on the full
// search-param shape. Hit rate expectation: moderate — multiple users hitting
// the same popular routes (YYZ→CUN, JFK→CDG) within the TTL window get the
// result returned in ~0ms instead of the 8-15s Duffel roundtrip.
//
// Rollback: set FLEXE_FLIGHT_CACHE=off in Railway to disable all caching and
// return to the pre-Phase-3 behaviour. No redeploy needed.
//
// Why in-process and not MCP: researched 2026-04 — no official Duffel MCP
// server exists and community ones don't cache. See commit message + plan
// notes at .claude/skills/README.md for the full rationale.

import type { FlightSearchParams, NormalizedFlight } from './types';

// ─── Tunables ──────────────────────────────────────────────────────────────
const TTL_MS = 60_000;           // 60s — short enough that prices stay fresh
const MAX_ENTRIES = 500;         // upper bound on memory footprint

// ─── Cache storage ─────────────────────────────────────────────────────────
interface CacheValue {
  flights:   NormalizedFlight[];
  sources:   string[];
  errors:    string[];
  // latencyMs is intentionally NOT cached — we recompute it per retrieval so
  // downstream admin stats reflect the cache-hit cost (near-zero) rather than
  // the original miss cost.
  ts:        number;
}

const cache = new Map<string, CacheValue>();

// ─── Metrics (process-local; reset on deploy) ──────────────────────────────
let hitCount = 0;
let missCount = 0;
let storeCount = 0;
let evictCount = 0;

// ─── Key derivation ────────────────────────────────────────────────────────
// Normalize the params object so semantically-equal queries hash to the same
// key. Order-independent for arrays (childrenAges), case-insensitive for IATA.

function makeKey(p: FlightSearchParams): string {
  return JSON.stringify({
    o:  p.origin?.toUpperCase()      ?? '',
    d:  p.destination?.toUpperCase() ?? '',
    dd: p.departureDate              ?? '',
    rd: p.returnDate                 ?? '',
    a:  p.adults                     ?? 1,
    c:  (p.childrenAges ?? []).slice().sort((a, b) => a - b),
    i:  p.infants                    ?? 0,
    cc: p.cabinClass                 ?? 'economy',
    mc: p.maxConnections             ?? null,
  });
}

// ─── Public API ────────────────────────────────────────────────────────────

export function isFlightCacheEnabled(): boolean {
  return process.env.FLEXE_FLIGHT_CACHE !== 'off';
}

export function lookupFlightCache(
  params: FlightSearchParams,
): Omit<CacheValue, 'ts'> | null {
  if (!isFlightCacheEnabled()) return null;

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

export function storeFlightCache(
  params: FlightSearchParams,
  value: Omit<CacheValue, 'ts'>,
): void {
  if (!isFlightCacheEnabled()) return;

  // Skip empty results — we'd rather retry than serve "0 flights" from cache.
  // Duffel occasionally returns empty on transient errors; caching that would
  // compound the problem.
  if (value.flights.length === 0) return;

  const key = makeKey(params);
  cache.set(key, { ...value, ts: Date.now() });
  storeCount++;

  // LRU-ish eviction: when at cap, drop the oldest entry by ts. O(n) scan,
  // fine at n=500.
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

export interface FlightCacheStats {
  enabled:   boolean;
  size:      number;
  maxSize:   number;
  ttlMs:     number;
  hits:      number;
  misses:    number;
  stores:    number;
  evictions: number;
  /** Hit rate as a fraction 0..1; null before any lookups */
  hitRate:   number | null;
}

export function getFlightCacheStats(): FlightCacheStats {
  const total = hitCount + missCount;
  return {
    enabled:   isFlightCacheEnabled(),
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

/** Tests only — clears the cache and resets counters. */
export function resetFlightCache(): void {
  cache.clear();
  hitCount = missCount = storeCount = evictCount = 0;
}
