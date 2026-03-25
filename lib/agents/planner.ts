// ─── Planner Agent ────────────────────────────────────────────────────────────
// Validates and enriches a TripIntent before it hits the search/ranking layer.
//
// Responsibilities:
//   • Validate date ranges (depart before return, not in the past)
//   • Validate IATA codes (basic format + length check)
//   • Clamp passenger counts to API-allowed ranges
//   • Attach reasonable defaults for missing optional fields
//   • Return a clean, validated TripIntent or a descriptive error

import type { TripIntent, AgentResult } from '@/lib/orchestrator/types';

// IATA airport codes — 3 uppercase letters
const IATA_RE = /^[A-Z]{3}$/;

// Maximum advance booking horizon (1 year)
const MAX_ADVANCE_DAYS = 365;

// Cabin class mapping — normalise any variant the AI might emit
const CABIN_MAP: Record<string, TripIntent['cabinClass']> = {
  economy:         'economy',
  eco:             'economy',
  'premium economy': 'premium_economy',
  'premium_economy': 'premium_economy',
  'premiumeconomy':  'premium_economy',
  business:        'business',
  first:           'first',
  'first class':   'first',
};

export const plannerAgent = {
  /**
   * Validate and enrich a TripIntent.
   * Returns the original intent (possibly enriched) or an error.
   */
  async plan(intent: TripIntent): Promise<AgentResult<TripIntent>> {
    const t0 = Date.now();
    const errors: string[] = [];

    // ── Origin / destination ─────────────────────────────────────────────────
    const origin = intent.origin?.trim().toUpperCase();
    const dest   = intent.destination?.trim().toUpperCase();

    if (!origin || !IATA_RE.test(origin)) {
      errors.push(`Invalid origin airport code: "${intent.origin}" (expected 3-letter IATA, e.g. YVR)`);
    }
    if (!dest || !IATA_RE.test(dest)) {
      // Destination might be a city name — try to keep it as-is with a warning
      // (downstream Duffel call will fail gracefully if not valid IATA)
      console.warn('[planner] destination is not IATA format:', dest);
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    const today  = new Date(); today.setHours(0, 0, 0, 0);
    const depart = new Date(intent.departDate);
    if (isNaN(depart.getTime())) {
      errors.push(`Invalid departDate: "${intent.departDate}" (expected YYYY-MM-DD)`);
    } else if (depart < today) {
      errors.push(`departDate ${intent.departDate} is in the past`);
    } else {
      const advanceDays = (depart.getTime() - today.getTime()) / 86400000;
      if (advanceDays > MAX_ADVANCE_DAYS) {
        errors.push(`departDate ${intent.departDate} is more than ${MAX_ADVANCE_DAYS} days out — Duffel doesn't carry fares that far ahead`);
      }
    }

    if (intent.returnDate) {
      const ret = new Date(intent.returnDate);
      if (isNaN(ret.getTime())) {
        errors.push(`Invalid returnDate: "${intent.returnDate}"`);
      } else if (!isNaN(depart.getTime()) && ret <= depart) {
        errors.push(`returnDate ${intent.returnDate} must be after departDate ${intent.departDate}`);
      }
    }

    // ── Hotel dates ──────────────────────────────────────────────────────────
    if (intent.checkIn && intent.checkOut) {
      const ci = new Date(intent.checkIn);
      const co = new Date(intent.checkOut);
      if (!isNaN(ci.getTime()) && !isNaN(co.getTime()) && co <= ci) {
        errors.push(`checkOut ${intent.checkOut} must be after checkIn ${intent.checkIn}`);
      }
    }

    // ── Passenger counts ─────────────────────────────────────────────────────
    const adults = Math.min(Math.max(1, Math.round(intent.adults ?? 1)), 9);
    const children = Math.min(Math.max(0, Math.round(intent.children ?? 0)), 9);
    if (adults + children > 9) {
      errors.push(`Total passengers (${adults + children}) exceeds Duffel's limit of 9`);
    }

    // ── Cabin class ──────────────────────────────────────────────────────────
    const rawCabin = (intent.cabinClass ?? 'economy').toLowerCase().trim();
    const cabin: TripIntent['cabinClass'] = CABIN_MAP[rawCabin] ?? 'economy';

    // ── Return errors ────────────────────────────────────────────────────────
    if (errors.length > 0) {
      return {
        ok:    false,
        error: errors.join('; '),
        durationMs: Date.now() - t0,
      };
    }

    // ── Return enriched intent ───────────────────────────────────────────────
    return {
      ok:   true,
      data: {
        ...intent,
        origin:      origin!,
        destination: dest ?? intent.destination,
        adults,
        children,
        cabinClass: cabin,
        preferences: {
          flexibility: intent.preferences?.flexibility ?? 'any',
          maxBudget:   intent.preferences?.maxBudget,
          minStars:    intent.preferences?.minStars,
        },
      },
      durationMs: Date.now() - t0,
    };
  },
};
