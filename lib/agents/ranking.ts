// ─── Ranking Agent ─────────────────────────────────────────────────────────────
// Fetches raw flights from Duffel, scores flexibility, ranks by weighted score.
//
// Rank formula (each component normalised 0–1, then weighted):
//   price       40% — cheaper = higher score (inverse normalisation)
//   flexibility 30% — FlexibilityScore.score (already 0–1)
//   duration    20% — shorter = higher score
//   stops       10% — fewer stops = higher score
//
// A flight tagged bookable=false (Amadeus reference fare) is demoted to the end
// so users always see the bookable Duffel options first.

import type { TripIntent, ScoredFlight, AgentResult, RankingWeights } from '@/lib/orchestrator/types';
import { DEFAULT_WEIGHTS } from '@/lib/orchestrator/types';
import { DuffelProvider }  from '@/lib/search/duffel';
import type { NormalizedFlight } from '@/lib/search/types';

// ─── Duration string → minutes ────────────────────────────────────────────────
function durationToMinutes(dur: string): number {
  // "14h 20m" or "5h" or "45m"
  const hm = dur.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/);
  if (!hm) return 0;
  return (parseInt(hm[1] ?? '0', 10) * 60) + parseInt(hm[2] ?? '0', 10);
}

// ─── Min-max normalise an array to 0–1 ────────────────────────────────────────
function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

// ─── Build rank score ─────────────────────────────────────────────────────────
function computeRankScores(
  flights: NormalizedFlight[],
  weights: RankingWeights,
): number[] {
  if (flights.length === 0) return [];

  const prices    = flights.map(f => f.price);
  const durations = flights.map(f => durationToMinutes(f.duration));
  const stops     = flights.map(f => f.stops);

  // Price: lower is better → invert after normalising
  const normPrice    = normalise(prices).map(v => 1 - v);
  // Duration: shorter is better → invert
  const normDuration = normalise(durations).map(v => 1 - v);
  // Stops: fewer is better → invert
  const normStops    = normalise(stops).map(v => 1 - v);
  // Flexibility: already 0–1 from FlexibilityScore, higher = more flexible = better

  return flights.map((_, i) => {
    const flex = (flights[i] as NormalizedFlight & { _flexScore?: number })._flexScore ?? 0.5;
    const raw  =
      normPrice[i]    * weights.price +
      flex            * weights.flexibility +
      normDuration[i] * weights.duration +
      normStops[i]    * weights.stops;
    return Math.round(raw * 100);  // 0–100
  });
}

export const rankingAgent = {
  /**
   * Search Duffel + rank results by flexibility + value.
   */
  async rank(
    intent: TripIntent,
    weights: RankingWeights = DEFAULT_WEIGHTS,
  ): Promise<AgentResult<ScoredFlight[]>> {
    const t0 = Date.now();

    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) {
      return { ok: false, error: 'DUFFEL_ACCESS_TOKEN not configured', durationMs: Date.now() - t0 };
    }

    try {
      const provider = new DuffelProvider(token);

      // searchFlights now returns NormalizedFlight with enrichedConditions attached
      const raw = await provider.searchFlights({
        origin:        intent.origin,
        destination:   intent.destination,
        departureDate: intent.departDate,
        returnDate:    intent.returnDate,
        adults:        intent.adults,
        cabinClass:    intent.cabinClass,
      });

      if (raw.length === 0) {
        return { ok: true, data: [], durationMs: Date.now() - t0 };
      }

      // Attach flexibility scores (DuffelProvider enriches these via _flexScore/_flexObj)
      const withFlex = raw as Array<NormalizedFlight & {
        _flexScore?: number;
        _flexObj?:   import('@/lib/orchestrator/types').FlexibilityScore;
      }>;

      // Compute rank scores
      const rankScores = computeRankScores(raw, weights);

      // Build ScoredFlight objects
      const scored: ScoredFlight[] = withFlex.map((f, i) => ({
        id:           f.id,
        provider:     f.provider as 'duffel' | 'amadeus',
        bookingToken: f.bookingToken ?? f.id,
        airline:      f.airline,
        airlineLogo:  f.airlineLogo,
        origin:       f.origin,
        destination:  f.destination,
        departure:    f.departure,
        arrival:      f.arrival,
        duration:     f.duration,
        stops:        f.stops,
        stopAirports: f.stopAirports,
        price:        f.price,
        currency:     f.currency,
        cabinClass:   f.cabinClass,
        passengers:   f.passengers ?? intent.adults,
        segments:     f.segments,
        flexibility:  f._flexObj ?? {
          score:               0.2,
          label:               'Locked' as const,
          refundable:          f.refundable ?? false,
          changeable:          false,
          refundPenaltyCents:  null,
          changePenaltyCents:  null,
          currency:            f.currency ?? 'USD',
          summary:             'Flexibility details unavailable — assume non-refundable.',
        },
        rankScore: rankScores[i],
        bookable:  !f.provider.startsWith('amadeus'),
      }));

      // Sort: bookable first, then by rankScore descending
      scored.sort((a, b) => {
        if (a.bookable !== b.bookable) return a.bookable ? -1 : 1;
        return b.rankScore - a.rankScore;
      });

      return { ok: true, data: scored, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },
};
