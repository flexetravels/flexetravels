// ─── Flight filter + rank helpers ─────────────────────────────────────────────
// Pure functions operating on NormalizedFlight[]. Extracted from aggregator.ts
// so they can be used standalone (smoke tests, eval harnesses, UI-side "relax
// filter" behaviour) without pulling in the provider chain.
//
// All filters here are POST-cache — they operate on the already-fetched flight
// array. See lib/search/flightCache.ts for why these are deliberately excluded
// from the cache key.

import type { FlightSearchParams, NormalizedFlight } from './types';

// ─── Region hub tables ────────────────────────────────────────────────────────
const REGION_HUBS: Record<'pacific' | 'europe' | 'middleeast', string[]> = {
  pacific:    ['SIN', 'BKK', 'NRT', 'HND', 'HKG', 'ICN', 'PVG', 'TPE', 'KUL', 'MNL'],
  europe:     ['LHR', 'CDG', 'AMS', 'FRA', 'IST', 'MAD', 'FCO', 'ZRH', 'MUC', 'BRU'],
  middleeast: ['DXB', 'DOH', 'AUH', 'JED', 'RUH', 'KWI'],
};

// ─── Airline matching ─────────────────────────────────────────────────────────
// Patterns short enough to look like IATA codes (2-3 chars) must match the
// segment carrier EXACTLY (case-insensitive). Longer patterns are treated as
// display names and matched by case-insensitive substring against the
// flight's airline field. This prevents "AI" from matching "Air Canada".

function isIataCode(pattern: string): boolean {
  const t = pattern.trim();
  return /^[A-Za-z0-9]{2,3}$/.test(t);
}

function codeMatches(carrier: string, pattern: string): boolean {
  return carrier.trim().toUpperCase() === pattern.trim().toUpperCase();
}

function nameMatches(airline: string, pattern: string): boolean {
  const a = airline.trim().toLowerCase();
  const b = pattern.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function flightUsesAirline(f: NormalizedFlight, banned: string[]): boolean {
  if (!banned?.length) return false;

  for (const pattern of banned) {
    if (isIataCode(pattern)) {
      const allSegs = [...f.segments, ...(f.returnSegments ?? [])];
      for (const seg of allSegs) {
        if (seg.carrier && codeMatches(seg.carrier, pattern)) return true;
        if (seg.operatingCarrier && codeMatches(seg.operatingCarrier, pattern)) return true;
      }
    } else if (nameMatches(f.airline, pattern)) {
      return true;
    }
  }
  return false;
}

function flightRoutesThroughRegion(
  f: NormalizedFlight,
  regions: Array<'pacific' | 'europe' | 'middleeast'>,
): boolean {
  if (!regions?.length) return true;
  const hubs  = new Set(regions.flatMap(r => REGION_HUBS[r]));
  const stops = [...f.stopAirports, ...(f.returnStopAirports ?? [])];
  return stops.some(s => hubs.has(s));
}

// ─── Public: apply all client-side filters ────────────────────────────────────
export function applyFlightFilters(
  flights: NormalizedFlight[],
  params: FlightSearchParams,
): NormalizedFlight[] {
  return flights.filter(f => {
    if (params.maxConnections != null && f.stops > params.maxConnections) return false;
    if (params.maxConnections != null && f.isRoundTrip && (f.returnStops ?? 0) > params.maxConnections) return false;
    if (params.maxPrice != null && f.price > params.maxPrice) return false;
    if (params.maxDurationMinutes != null) {
      const total = (f.durationMinutes ?? 0) + (f.returnDurationMinutes ?? 0);
      if (total > params.maxDurationMinutes) return false;
    }
    if (params.avoidAirlines?.length && flightUsesAirline(f, params.avoidAirlines)) return false;
    if (params.viaRegions?.length && !flightRoutesThroughRegion(f, params.viaRegions)) return false;
    if (params.departAfter) {
      const hhmm = f.departure?.slice(11, 16);
      if (hhmm && hhmm < params.departAfter) return false;
    }
    if (params.departBefore) {
      const hhmm = f.departure?.slice(11, 16);
      if (hhmm && hhmm > params.departBefore) return false;
    }
    return true;
  });
}

// ─── Public: composite duration + price ranking ───────────────────────────────
// User default: "ordered by least duration and price".
// Score = 0.5 * priceNorm + 0.5 * durationNorm, lower is better. Min-max
// normalization over the current result set so neither dimension dominates.
// For round-trips, duration is the sum of outbound + return minutes.

function totalMinutes(f: NormalizedFlight): number {
  return (f.durationMinutes ?? 0) + (f.returnDurationMinutes ?? 0);
}

export function rankByDurationPrice(flights: NormalizedFlight[]): NormalizedFlight[] {
  if (flights.length <= 1) return flights;

  const prices    = flights.map(f => f.price);
  const durations = flights.map(totalMinutes);
  const pMin = Math.min(...prices),    pMax = Math.max(...prices);
  const dMin = Math.min(...durations), dMax = Math.max(...durations);
  const pSpan = pMax - pMin || 1;
  const dSpan = dMax - dMin || 1;

  const scored = flights.map(f => ({
    f,
    score: 0.5 * ((f.price - pMin) / pSpan) + 0.5 * ((totalMinutes(f) - dMin) / dSpan),
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.map(s => s.f);
}
