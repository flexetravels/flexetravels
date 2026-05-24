// ─── Duffel Search Provider ────────────────────────────────────────────────────
// Docs: https://duffel.com/docs/api
// Test mode: DUFFEL_ACCESS_TOKEN starts with "duffel_test_"
// Rate limits: 10 req/s test, 100 req/s live

import type {
  SearchProvider, FlightSearchParams,
  NormalizedFlight, NormalizedHotel, FareVariant,
} from './types';
import { airlineLogo } from '@/lib/utils';
import {
  scoreFlexibility,
  type DuffelConditions,
  type FlexibilityScore,
} from '@/lib/scoring/flexibility';

// ─── Duffel raw API types ──────────────────────────────────────────────────────
interface DuffelBaggage {
  type:     string;   // 'checked' | 'carry_on'
  quantity: number;
}
interface DuffelPassenger {
  baggages?: DuffelBaggage[];
}
interface DuffelSegment {
  origin:       { iata_code: string };
  destination:  { iata_code: string };
  departing_at: string;
  arriving_at:  string;
  duration:     string;
  marketing_carrier:               { iata_code: string; name: string; logo_symbol_url?: string };
  operating_carrier?:              { iata_code: string; name: string };
  marketing_carrier_flight_number: string;
  passengers?:  DuffelPassenger[];
}
interface DuffelSlice {
  duration:         string;
  segments:         DuffelSegment[];
  fare_brand_name?: string;   // Airline's own fare tier label (e.g. "Economy Light")
}
interface DuffelOffer {
  id:             string;
  total_amount:   string;
  total_currency: string;
  owner:          { name: string; logo_symbol_url?: string };
  slices:         DuffelSlice[];
  conditions?:    DuffelConditions;
}

const DUFFEL_OFFER_TIMEOUT_MS = 25_000;
const DUFFEL_FALLBACK_TIMEOUT_MS = 18_000;

function duffelTimeoutMessage() {
  return 'Duffel live fares took too long to respond. Please retry the search; we only show fares after the provider confirms them.';
}

function isTimeoutError(err: unknown) {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

// ─── Enriched NormalizedFlight ────────────────────────────────────────────────
// Private fields (prefixed _) carry scored flexibility data to the ranking agent.
export interface EnrichedFlight extends NormalizedFlight {
  _flexScore: number;           // 0–1 from FlexibilityScore
  _flexObj:   FlexibilityScore; // Full scored object
  _fareBrandName?: string;      // Airline's own fare brand (e.g. "Economy Light")
  _checkedBags?:   number;      // Checked bag quantity for first passenger
}

/** Convert Duffel ISO 8601 duration → "14h 20m"
 *  Handles: PT14H20M, PT5H15M, PT45M, P1DT50M, P1DT2H30M
 *  Day values are converted to hours (P1DT50M → 24h 50m). */
function fmtDuration(iso: string): string {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m || (!m[1] && !m[2] && !m[3])) return iso;
  const totalHours = (parseInt(m[1] ?? '0') * 24) + parseInt(m[2] ?? '0');
  const mins       = parseInt(m[3] ?? '0');
  const parts: string[] = [];
  if (totalHours > 0) parts.push(`${totalHours}h`);
  if (mins        > 0) parts.push(`${mins}m`);
  return parts.join(' ') || iso;
}

function mapSegment(seg: DuffelSegment) {
  return {
    origin:           seg.origin?.iata_code ?? '',
    destination:      seg.destination?.iata_code ?? '',
    departure:        seg.departing_at ?? '',
    arrival:          seg.arriving_at ?? '',
    duration:         fmtDuration(seg.duration ?? ''),
    carrier:          seg.marketing_carrier?.iata_code ?? '',
    operatingCarrier: seg.operating_carrier?.iata_code ?? seg.marketing_carrier?.iata_code ?? '',
    flightNumber:     `${seg.marketing_carrier?.iata_code ?? ''}${seg.marketing_carrier_flight_number ?? ''}`,
  };
}

function mapOffer(offer: DuffelOffer, cabinClass: string, totalPassengers: number, paxBreakdown?: { adults: number; childrenAges?: number[]; infantCount?: number }): EnrichedFlight {
  // Outbound slice (always present)
  const slice0 = offer.slices?.[0];
  const segs   = slice0?.segments ?? [];
  const first  = segs[0];
  const last   = segs[segs.length - 1];

  // Return slice (present for round-trip offers)
  const slice1    = offer.slices?.[1];
  const retSegs   = slice1?.segments ?? [];
  const retFirst  = retSegs[0];
  const retLast   = retSegs[retSegs.length - 1];

  // Use the first segment's carrier IATA code for the logo (avs.io CDN — no DNS issues)
  const firstCarrierIata = first?.marketing_carrier?.iata_code ?? '';

  // Score flexibility from Duffel conditions object
  const fareCents = Math.round(parseFloat(offer.total_amount ?? '0') * 100);
  const flexObj   = scoreFlexibility(offer.conditions ?? null, fareCents, offer.total_currency ?? 'USD');

  // Extract fare brand name from first slice (airline's own label like "Economy Light")
  const fareBrandName = slice0?.fare_brand_name ?? undefined;

  // Extract checked bag count from the first passenger on the first segment
  const firstPax   = first?.passengers?.[0];
  const checkedBag = firstPax?.baggages?.find(b => b.type === 'checked');
  const checkedBags = checkedBag?.quantity ?? undefined;

  return {
    id:           offer.id,
    provider:     'duffel',
    airline:      offer.owner?.name ?? 'Unknown',
    airlineLogo:  airlineLogo(firstCarrierIata),
    origin:       first?.origin?.iata_code ?? '',
    destination:  last?.destination?.iata_code ?? '',
    departure:    first?.departing_at ?? '',
    arrival:      last?.arriving_at ?? '',
    duration:     fmtDuration(slice0?.duration ?? ''),
    stops:        segs.length - 1,
    stopAirports: segs.slice(0, -1).map(s => s.destination?.iata_code ?? ''),
    price:        parseFloat(offer.total_amount ?? '0'),
    currency:     offer.total_currency ?? 'USD',
    cabinClass,
    refundable:   flexObj.refundable,
    bookingToken: offer.id,
    passengers:   totalPassengers,
    searchedAdults: paxBreakdown?.adults ?? totalPassengers,
    childrenAges:   paxBreakdown?.childrenAges,
    infantCount:    paxBreakdown?.infantCount ?? 0,
    segments:     segs.map(mapSegment),
    // ── Round-trip return leg (populated when offer has 2 slices) ────────────
    ...(slice1 ? {
      isRoundTrip:        true,
      returnOrigin:       retFirst?.origin?.iata_code ?? '',
      returnDestination:  retLast?.destination?.iata_code ?? '',
      returnDeparture:    retFirst?.departing_at ?? '',
      returnArrival:      retLast?.arriving_at ?? '',
      returnDuration:     fmtDuration(slice1.duration ?? ''),
      returnStops:        retSegs.length - 1,
      returnStopAirports: retSegs.slice(0, -1).map(s => s.destination?.iata_code ?? ''),
      returnSegments:     retSegs.map(mapSegment),
    } : {}),
    // ── Enriched flexibility data (consumed by ranking agent) ────────────────
    _flexScore: flexObj.score,
    _flexObj:   flexObj,
    _fareBrandName: fareBrandName,
    _checkedBags:   checkedBags,
  };
}

/**
 * Group a sorted list of EnrichedFlights by physical flight identity
 * (same flight numbers + same departure time) and return at most one
 * NormalizedFlight per physical flight, carrying up to 3 fare variants
 * (cheapest, most flexible, and a mid-tier when available).
 */
function groupIntoFareVariants(
  sortedFlights: EnrichedFlight[],
  limit: number = 10,
): NormalizedFlight[] {
  // Accumulate offers per unique physical flight
  const offerMap = new Map<string, EnrichedFlight[]>();
  for (const f of sortedFlights) {
    const key = [
      f.segments.map(s => s.flightNumber).join('|'),
      f.departure.slice(0, 16),
    ].join('::');
    if (!offerMap.has(key)) offerMap.set(key, []);
    offerMap.get(key)!.push(f);
  }

  const results: NormalizedFlight[] = [];
  for (const [, group] of offerMap) {
    if (results.length >= limit) break;

    // group is already sorted cheapest-first because sortedFlights was sorted
    const cheapest    = group[0];
    const mostFlex    = group.reduce((best, v) => v._flexScore > best._flexScore ? v : best, group[0]);

    const selected: EnrichedFlight[] = [cheapest];
    if (mostFlex.id !== cheapest.id) selected.push(mostFlex);
    // Fill up to 3 with any remaining variant not yet selected
    for (const v of group) {
      if (selected.length >= 3) break;
      if (!selected.some(s => s.id === v.id)) selected.push(v);
    }

    const fareVariants: FareVariant[] = selected.map(v => ({
      offerId:            v.id,
      price:              v.price,
      currency:           v.currency,
      flexibilityScore:   v._flexScore,
      flexibilityLabel:   v._flexObj.label,
      flexibilitySummary: v._flexObj.summary,
      refundable:         v.refundable,
      changeable:         v._flexObj.changeable,
      fareBrandName:      v._fareBrandName,
      checkedBags:        v._checkedBags,
    }));

    results.push({ ...cheapest, fareVariants });
  }

  return results;
}

/** Rank offer by non-stop status: 0=all-legs non-stop, 1=one leg non-stop, 3=all legs have stops */
function nonStopRank(offer: DuffelOffer): number {
  const outNonStop = (offer.slices[0]?.segments?.length ?? 0) === 1;
  if (offer.slices.length < 2) return outNonStop ? 0 : 3;
  const retNonStop = (offer.slices[1]?.segments?.length ?? 0) === 1;
  if (outNonStop && retNonStop) return 0;
  if (outNonStop || retNonStop) return 1;
  return 3;
}

export class DuffelProvider implements SearchProvider {
  readonly name = 'duffel';
  private readonly token: string;
  private readonly baseUrl = 'https://api.duffel.com';

  constructor(token: string) {
    this.token = token;
  }

  private get headers() {
    return {
      Authorization:    `Bearer ${this.token}`,
      'Duffel-Version': 'v2',
      'Content-Type':   'application/json',
      Accept:           'application/json',
    };
  }

  async searchFlights(params: FlightSearchParams): Promise<NormalizedFlight[]> {
    const slices: { origin: string; destination: string; departure_date: string; max_connections?: number }[] = [
      { origin: params.origin, destination: params.destination, departure_date: params.departureDate,
        ...(params.maxConnections != null ? { max_connections: params.maxConnections } : {}) },
    ];
    if (params.returnDate) {
      slices.push({ origin: params.destination, destination: params.origin, departure_date: params.returnDate,
        ...(params.maxConnections != null ? { max_connections: params.maxConnections } : {}) });
    }

    // Build passenger array: adults + children (2-11) + lap infants (under 2).
    // Duffel live API fully supports infant_without_seat — included here so the offer
    // contains the correct passenger slots for accurate order creation at booking time.
    // Infant fares are typically free or nominal; the price shown covers adult + child seats.
    const childrenAges = params.childrenAges ?? [];
    const infantCount  = params.infants ?? 0;

    // Validate infant count: Duffel requires at least one adult per infant
    if (infantCount > params.adults) {
      throw new Error('Number of infants cannot exceed number of adults');
    }

    // Duffel v2 passenger format:
    //   Adults:  { type: 'adult' }
    //   Children (2-11): { age: N }  ← age only, NO type field (v2 infers child from age)
    //   Infants:  { type: 'infant_without_seat' }
    const passengers: Array<{ type?: string; age?: number }> = [
      ...Array.from({ length: params.adults },    () => ({ type: 'adult'              as const })),
      ...childrenAges.map(age                  => ({ age })),
      ...Array.from({ length: infantCount },    () => ({ type: 'infant_without_seat' as const })),
    ];
    const totalPassengers = passengers.length;

    // Duffel max 9 passengers
    if (totalPassengers > 9) {
      throw new Error('Maximum 9 passengers allowed per booking');
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/air/offer_requests?return_offers=true`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          data: {
            slices,
            passengers,
            cabin_class: params.cabinClass,
          },
        }),
        signal: AbortSignal.timeout(DUFFEL_OFFER_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTimeoutError(err)) throw new Error(duffelTimeoutMessage());
      throw err;
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Duffel ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json = await res.json() as { data?: { offers?: DuffelOffer[] } };
    const offers = json.data?.offers ?? [];

    // If results came back with children/infants but returned 0 offers, some airlines
    // don't price child/infant fares via the offer_requests API — this is a carrier-side
    // limitation, not an API parameter error. The `child` / `infant_without_seat` params
    // are correct. We fall back to an adults-only query so the route is still bookable,
    // but we tag every returned offer with `childFareNote` so the UI and AI can surface a
    // transparent disclosure: "Adult pricing shown — child seat confirmed at booking."
    if (offers.length === 0 && (childrenAges.length > 0 || infantCount > 0)) {
      const childDesc: string[] = [];
      if (childrenAges.length > 0) {
        childDesc.push(childrenAges.map(a => `age ${a}`).join(', '));
      }
      if (infantCount > 0) {
        childDesc.push(infantCount === 1 ? '1 lap infant' : `${infantCount} lap infants`);
      }
      const note = `Adult pricing shown — this airline doesn't quote child fares (${childDesc.join('; ')}) in the search API. Child seat${childrenAges.length > 1 ? 's' : ''} confirmed at booking.`;

      console.log('[duffel] 0 offers with children/infants — retrying adults-only (with disclosure) for', params.origin, '→', params.destination);
      const adultOnlyPassengers = Array.from({ length: params.adults }, () => ({ type: 'adult' as const }));
      try {
        const fallbackRes = await fetch(`${this.baseUrl}/air/offer_requests?return_offers=true`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
            data: { slices, passengers: adultOnlyPassengers, cabin_class: params.cabinClass },
          }),
          signal: AbortSignal.timeout(DUFFEL_FALLBACK_TIMEOUT_MS),
        });
        if (fallbackRes.ok) {
          const fallbackJson = await fallbackRes.json() as { data?: { offers?: DuffelOffer[] } };
          const fallbackOffers = fallbackJson.data?.offers ?? [];
          if (fallbackOffers.length > 0) {
            console.log('[duffel] adults-only fallback returned', fallbackOffers.length, 'offers — tagging with childFareNote');
            const sortedFallback = fallbackOffers
              .sort((a, b) => {
                const rankDiff = nonStopRank(a) - nonStopRank(b);
                if (rankDiff !== 0) return rankDiff;
                return parseFloat(a.total_amount) - parseFloat(b.total_amount);
              })
              .map(o => mapOffer(o, params.cabinClass, params.adults, { adults: params.adults, childrenAges, infantCount }));
            return groupIntoFareVariants(sortedFallback, 10)
              .map(f => ({ ...f, childFareNote: note }));
          }
        }
      } catch (err) {
        console.warn('[duffel] adults-only fallback also failed:', String(err));
      }
    }

    // Group offers by physical flight identity (flight numbers + departure time).
    // Multiple fare classes for the same physical flight (e.g. WestJet basic/standard/flex)
    // are collected into a fareVariants array rather than collapsed to cheapest-only.
    // This lets the card UI show fare tiers while still returning diverse airlines/routes
    // (one entry per distinct physical flight, up to 10 distinct flights).
    const sortedMapped = offers
      .sort((a, b) => {
        const rankDiff = nonStopRank(a) - nonStopRank(b);
        if (rankDiff !== 0) return rankDiff;
        return parseFloat(a.total_amount) - parseFloat(b.total_amount);
      })
      .map(o => mapOffer(o, params.cabinClass, totalPassengers, { adults: params.adults, childrenAges, infantCount }));

    return groupIntoFareVariants(sortedMapped, 10);
  }

  // Duffel doesn't have a hotel search API — return empty, Amadeus handles hotels
  async searchHotels(): Promise<NormalizedHotel[]> {
    return [];
  }
}
