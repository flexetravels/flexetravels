// ─── Duffel Search Provider ────────────────────────────────────────────────────
// Docs: https://duffel.com/docs/api
// Test mode: DUFFEL_ACCESS_TOKEN starts with "duffel_test_"
// Rate limits: 10 req/s test, 100 req/s live

import type {
  SearchProvider, FlightSearchParams, HotelSearchParams,
  NormalizedFlight, NormalizedHotel,
} from './types';
import { airlineLogo } from '@/lib/utils';
import {
  scoreFlexibility,
  type DuffelConditions,
  type FlexibilityScore,
} from '@/lib/scoring/flexibility';

// ─── Duffel raw API types ──────────────────────────────────────────────────────
interface DuffelSegment {
  origin:       { iata_code: string };
  destination:  { iata_code: string };
  departing_at: string;
  arriving_at:  string;
  duration:     string;
  marketing_carrier:               { iata_code: string; name: string; logo_symbol_url?: string };
  operating_carrier?:              { iata_code: string; name: string };
  marketing_carrier_flight_number: string;
}
interface DuffelSlice {
  duration: string;
  segments: DuffelSegment[];
}
interface DuffelOffer {
  id:             string;
  total_amount:   string;
  total_currency: string;
  owner:          { name: string; logo_symbol_url?: string };
  slices:         DuffelSlice[];
  conditions?:    DuffelConditions;
}

// ─── Enriched NormalizedFlight ────────────────────────────────────────────────
// Private fields (prefixed _) carry scored flexibility data to the ranking agent.
export interface EnrichedFlight extends NormalizedFlight {
  _flexScore: number;           // 0–1 from FlexibilityScore
  _flexObj:   FlexibilityScore; // Full scored object
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

function mapOffer(offer: DuffelOffer, cabinClass: string, totalPassengers: number): EnrichedFlight {
  const slice0 = offer.slices?.[0];
  const segs   = slice0?.segments ?? [];
  const first  = segs[0];
  const last   = segs[segs.length - 1];

  // Use the first segment's carrier IATA code for the logo (avs.io CDN — no DNS issues)
  const firstCarrierIata = first?.marketing_carrier?.iata_code ?? '';

  // Score flexibility from Duffel conditions object
  const fareCents = Math.round(parseFloat(offer.total_amount ?? '0') * 100);
  const flexObj   = scoreFlexibility(offer.conditions ?? null, fareCents, offer.total_currency ?? 'USD');

  return {
    id:           offer.id,
    provider:     'duffel',
    airline:      offer.owner?.name ?? 'Unknown',
    airlineLogo:  airlineLogo(firstCarrierIata), // ← avs.io URL, not Duffel's clearbit URL
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
    segments:     segs.map(seg => ({
      origin:       seg.origin?.iata_code ?? '',
      destination:  seg.destination?.iata_code ?? '',
      departure:    seg.departing_at ?? '',
      arrival:      seg.arriving_at ?? '',
      duration:     fmtDuration(seg.duration ?? ''),
      carrier:      seg.marketing_carrier?.iata_code ?? '', // IATA code (e.g. "AC"), used for logo lookup
      operatingCarrier: seg.operating_carrier?.iata_code ?? seg.marketing_carrier?.iata_code ?? '',
      flightNumber: `${seg.marketing_carrier?.iata_code ?? ''}${seg.marketing_carrier_flight_number ?? ''}`,
    })),
    // ── Enriched flexibility data (consumed by ranking agent) ────────────────
    _flexScore: flexObj.score,
    _flexObj:   flexObj,
  };
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
    const slices: { origin: string; destination: string; departure_date: string }[] = [
      { origin: params.origin, destination: params.destination, departure_date: params.departureDate },
    ];
    if (params.returnDate) {
      slices.push({ origin: params.destination, destination: params.origin, departure_date: params.returnDate });
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

    const res = await fetch(`${this.baseUrl}/air/offer_requests?return_offers=true`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        data: {
          slices,
          passengers,
          cabin_class: params.cabinClass,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

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
          signal: AbortSignal.timeout(12_000),
        });
        if (fallbackRes.ok) {
          const fallbackJson = await fallbackRes.json() as { data?: { offers?: DuffelOffer[] } };
          const fallbackOffers = fallbackJson.data?.offers ?? [];
          if (fallbackOffers.length > 0) {
            console.log('[duffel] adults-only fallback returned', fallbackOffers.length, 'offers — tagging with childFareNote');
            return fallbackOffers
              .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
              .slice(0, 10)
              .map(o => ({ ...mapOffer(o, params.cabinClass, params.adults), childFareNote: note }));
          }
        }
      } catch (err) {
        console.warn('[duffel] adults-only fallback also failed:', String(err));
      }
    }

    return offers
      .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
      .slice(0, 10)  // Fetch more so ranking agent has options to sort
      .map(o => mapOffer(o, params.cabinClass, totalPassengers));
  }

  // Duffel doesn't have a hotel search API — return empty, Amadeus handles hotels
  async searchHotels(_params: HotelSearchParams): Promise<NormalizedHotel[]> {
    return [];
  }
}
