// ─── Hotel filter + rank helpers ──────────────────────────────────────────────
// Pure functions operating on NormalizedHotel[]. Mirrors flightFilters.ts.
// All filters are POST-cache — they run on the already-fetched hotel array
// so one LiteAPI fetch serves many filter permutations.

import type { HotelSearchParams, NormalizedHotel } from './types';

// ─── Amenity matching ─────────────────────────────────────────────────────────
// LiteAPI amenity strings are inconsistent ("Free WiFi", "WiFi", "Wi-Fi",
// "Wireless Internet"). We normalise both sides and match by substring.

function normalizeAmenity(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hotelHasAmenity(h: NormalizedHotel, required: string): boolean {
  const needle = normalizeAmenity(required);
  if (!needle) return true;
  return h.amenities.some(a => {
    const hay = normalizeAmenity(a);
    return hay.includes(needle) || needle.includes(hay);
  });
}

function freeCancellationMatch(h: NormalizedHotel): boolean {
  if (!h.cancellation) return false;
  return /\bfree\b/i.test(h.cancellation);
}

// ─── Public: apply all client-side hotel filters ──────────────────────────────
export function applyHotelFilters(
  hotels: NormalizedHotel[],
  params: HotelSearchParams,
): NormalizedHotel[] {
  return hotels.filter(h => {
    if (params.maxPrice    != null && h.pricePerNight > params.maxPrice) return false;
    if (params.stars       != null && h.stars         < params.stars)    return false;
    if (params.minRating   != null && h.rating        < params.minRating) return false;
    if (params.minReviewCount != null && (h.reviewCount ?? 0) < params.minReviewCount) return false;
    if (params.boardType) {
      const board = (h as { boardType?: string }).boardType;
      if (!board || board !== params.boardType) return false;
    }
    if (params.freeCancellation && !freeCancellationMatch(h)) return false;
    if (params.amenities?.length) {
      if (!params.amenities.every(a => hotelHasAmenity(h, a))) return false;
    }
    return true;
  });
}

// ─── Ranking: composite rating + price ────────────────────────────────────────
// Default: balance guest rating (higher is better) against price (lower is
// better). Score = 0.5 * (1 - ratingNorm) + 0.5 * priceNorm, lower wins.
// Hotels without a rating are demoted slightly (rating treated as 5/10).

function effectiveRating(h: NormalizedHotel): number {
  return h.rating > 0 ? h.rating : 5;
}

export function rankByRatingPrice(hotels: NormalizedHotel[]): NormalizedHotel[] {
  if (hotels.length <= 1) return hotels;

  const prices  = hotels.map(h => h.pricePerNight);
  const ratings = hotels.map(effectiveRating);
  const pMin = Math.min(...prices),  pMax = Math.max(...prices);
  const rMin = Math.min(...ratings), rMax = Math.max(...ratings);
  const pSpan = pMax - pMin || 1;
  const rSpan = rMax - rMin || 1;

  const scored = hotels.map(h => {
    const priceNorm  = (h.pricePerNight - pMin) / pSpan;
    const ratingNorm = (effectiveRating(h) - rMin) / rSpan;
    return {
      h,
      score: 0.5 * priceNorm + 0.5 * (1 - ratingNorm),
    };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map(s => s.h);
}
