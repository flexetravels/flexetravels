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

/** Convert Duffel ISO 8601 duration (PT14H20M) → "14h 20m" */
function fmtDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h   = m[1] ? `${m[1]}h` : '';
  const min = m[2] ? ` ${m[2]}m` : '';
  return `${h}${min}`.trim() || iso;
}

function mapOffer(offer: DuffelOffer, cabinClass: string, adults: number): EnrichedFlight {
  const slice0 = offer.slices?.[0];
  const segs   = slice0?.segments ?? [];
  const first  = segs[0];
  const last   = segs[segs.length - 1];

  // Use the first segment's carrier IATA code for the logo (avs.io CDN — no DNS issues)
  const firstCarrierIata = first?.marketing_carrier?.iata_code ?? '';

  // Score flexibility from Duffel conditions object
  const fareCents = Math.round(parseFloat(offer.total_amount ?? '0') * 100);
  const flexObj   = scoreFlexibility(offer.conditions ?? null, fareCents);

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
    passengers:   adults,
    segments:     segs.map(seg => ({
      origin:       seg.origin?.iata_code ?? '',
      destination:  seg.destination?.iata_code ?? '',
      departure:    seg.departing_at ?? '',
      arrival:      seg.arriving_at ?? '',
      duration:     fmtDuration(seg.duration ?? ''),
      carrier:      seg.marketing_carrier?.iata_code ?? '', // IATA code (e.g. "AC"), used for logo lookup
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

    const res = await fetch(`${this.baseUrl}/air/offer_requests?return_offers=true`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        data: {
          slices,
          passengers: Array.from({ length: params.adults }, () => ({ type: 'adult' })),
          cabin_class: params.cabinClass,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Duffel ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json = await res.json() as { data?: { offers?: DuffelOffer[] } };
    return (json.data?.offers ?? [])
      .sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))
      .slice(0, 10)  // Fetch more so ranking agent has options to sort
      .map(o => mapOffer(o, params.cabinClass, params.adults));
  }

  // Duffel doesn't have a hotel search API — return empty, Amadeus handles hotels
  async searchHotels(_params: HotelSearchParams): Promise<NormalizedHotel[]> {
    return [];
  }
}
