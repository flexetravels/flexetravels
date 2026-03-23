// ─── Amadeus Search Provider ───────────────────────────────────────────────────
// Free self-service API: https://developers.amadeus.com
// Covers: flights (Flight Offers Search) + hotels (Hotel List + Hotel Offers)
// Auth: OAuth2 client_credentials, token cached for 25 minutes

import type {
  SearchProvider, FlightSearchParams, HotelSearchParams,
  NormalizedFlight, NormalizedHotel,
} from './types';

const AMADEUS_BASE = 'https://test.api.amadeus.com'; // use 'api.amadeus.com' in production

// ─── Token cache (module-level, reused across requests in the same process) ───
let _cachedToken: string | null = null;
let _tokenExpiry = 0;

async function getAmadeusToken(clientId: string, clientSecret: string): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _cachedToken = data.access_token;
  _tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000; // expire 1 min early
  return _cachedToken;
}

// ─── IATA city → airport code lookup (used if city name given instead of IATA) ─
async function cityToIata(token: string, keyword: string): Promise<string> {
  // If already looks like IATA code, return as-is
  if (/^[A-Z]{3}$/.test(keyword.trim().toUpperCase())) return keyword.trim().toUpperCase();

  const res = await fetch(
    `${AMADEUS_BASE}/v1/reference-data/locations?subType=AIRPORT,CITY&keyword=${encodeURIComponent(keyword)}&sort=analytics.travelers.score&page[limit]=1`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) }
  );
  if (!res.ok) return keyword;
  const data = await res.json() as { data?: { iataCode: string }[] };
  return data.data?.[0]?.iataCode ?? keyword;
}

// ─── Duration formatter ────────────────────────────────────────────────────────
function fmtDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h   = m[1] ? `${m[1]}h` : '';
  const min = m[2] ? ` ${m[2]}m` : '';
  return `${h}${min}`.trim() || iso;
}

// ─── Amadeus raw types ────────────────────────────────────────────────────────
interface AmadeusSegment {
  departure:     { iataCode: string; at: string };
  arrival:       { iataCode: string; at: string };
  carrierCode:   string;
  number:        string;
  duration:      string;
  aircraft?:     { code: string };
}
interface AmadeusItinerary {
  duration: string;
  segments: AmadeusSegment[];
}
interface AmadeusOffer {
  id:           string;
  price:        { total: string; currency: string };
  itineraries:  AmadeusItinerary[];
  validatingAirlineCodes: string[];
  travelerPricings?: Array<{ fareDetailsBySegment?: Array<{ cabin?: string }> }>;
  pricingOptions?: { refundableFare?: boolean };
}

// Carrier name lookup (simplified — we use code if full name unavailable)
const CARRIER_NAMES: Record<string, string> = {
  AC: 'Air Canada', WS: 'WestJet', UA: 'United Airlines', AA: 'American Airlines',
  DL: 'Delta Air Lines', WN: 'Southwest Airlines', B6: 'JetBlue', AS: 'Alaska Airlines',
  F9: 'Frontier Airlines', NK: 'Spirit Airlines', G4: 'Allegiant Air',
  HA: 'Hawaiian Airlines', SY: 'Sun Country', MX: 'Breeze Airways',
};

function mapAmadeusFlight(offer: AmadeusOffer, cabinClass: string, adults: number): NormalizedFlight {
  const itin0 = offer.itineraries?.[0];
  const segs  = itin0?.segments ?? [];
  const first = segs[0];
  const last  = segs[segs.length - 1];
  const code  = offer.validatingAirlineCodes?.[0] ?? first?.carrierCode ?? '??';

  return {
    id:           `amadeus_${offer.id}`,
    provider:     'amadeus',
    airline:      CARRIER_NAMES[code] ?? code,
    origin:       first?.departure?.iataCode ?? '',
    destination:  last?.arrival?.iataCode ?? '',
    departure:    first?.departure?.at ?? '',
    arrival:      last?.arrival?.at ?? '',
    duration:     fmtDuration(itin0?.duration ?? ''),
    stops:        segs.length - 1,
    stopAirports: segs.slice(0, -1).map(s => s.arrival?.iataCode ?? ''),
    price:        parseFloat(offer.price?.total ?? '0'),
    currency:     offer.price?.currency ?? 'USD',
    cabinClass,
    refundable:   offer.pricingOptions?.refundableFare ?? false,
    bookingToken: offer.id,
    passengers:   adults,
    segments:     segs.map(seg => ({
      origin:       seg.departure?.iataCode ?? '',
      destination:  seg.arrival?.iataCode ?? '',
      departure:    seg.departure?.at ?? '',
      arrival:      seg.arrival?.at ?? '',
      duration:     fmtDuration(seg.duration ?? ''),
      carrier:      CARRIER_NAMES[seg.carrierCode] ?? seg.carrierCode,
      flightNumber: `${seg.carrierCode}${seg.number}`,
    })),
  };
}

// ─── Hotel types ──────────────────────────────────────────────────────────────
interface AmadeusHotelOffer {
  hotel: {
    hotelId:   string;
    name:      string;
    cityCode:  string;
    rating?:   string;
    amenities?: string[];
    address?:  { lines?: string[]; cityName?: string };
    media?:    Array<{ uri: string }>;
  };
  offers?: Array<{
    id:    string;
    price: { total: string; currency: string };
    room?: { description?: { text?: string } };
    policies?: { cancellation?: { description?: { text?: string } } };
  }>;
}

export class AmadeusProvider implements SearchProvider {
  readonly name = 'amadeus';
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
  }

  private async token(): Promise<string> {
    return getAmadeusToken(this.clientId, this.clientSecret);
  }

  async searchFlights(params: FlightSearchParams): Promise<NormalizedFlight[]> {
    const tok = await this.token();

    const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`);
    url.searchParams.set('originLocationCode',      params.origin.toUpperCase());
    url.searchParams.set('destinationLocationCode', params.destination.toUpperCase());
    url.searchParams.set('departureDate',           params.departureDate);
    url.searchParams.set('adults',                  String(params.adults));
    url.searchParams.set('travelClass',             params.cabinClass.toUpperCase());
    url.searchParams.set('max',                     '6');
    url.searchParams.set('currencyCode',            'USD');
    if (params.returnDate) {
      url.searchParams.set('returnDate', params.returnDate);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Amadeus flights ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json() as { data?: AmadeusOffer[] };
    return (data.data ?? []).map(o => mapAmadeusFlight(o, params.cabinClass, params.adults));
  }

  async searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]> {
    const tok = await this.token();

    // Step 1: Resolve IATA city code
    const cityCode = await cityToIata(tok, params.destination);

    // Step 2: Get hotel list for city
    const listUrl = new URL(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city`);
    listUrl.searchParams.set('cityCode',  cityCode);
    listUrl.searchParams.set('radius',    '20');
    listUrl.searchParams.set('radiusUnit','KM');
    listUrl.searchParams.set('ratings',   '3,4,5');

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!listRes.ok) throw new Error(`Amadeus hotel list ${listRes.status}`);
    const listData = await listRes.json() as { data?: Array<{ hotelId: string }> };
    const hotelIds = (listData.data ?? []).slice(0, 20).map(h => h.hotelId);
    if (hotelIds.length === 0) return [];

    // Step 3: Get offers for these hotels
    const offUrl = new URL(`${AMADEUS_BASE}/v3/shopping/hotel-offers`);
    offUrl.searchParams.set('hotelIds',   hotelIds.join(','));
    offUrl.searchParams.set('adults',     String(params.adults));
    offUrl.searchParams.set('checkInDate',  params.checkIn);
    offUrl.searchParams.set('checkOutDate', params.checkOut);
    offUrl.searchParams.set('currency',   'USD');
    offUrl.searchParams.set('bestRateOnly','true');
    if (params.maxPrice) offUrl.searchParams.set('priceRange', `0-${params.maxPrice}`);

    const offRes = await fetch(offUrl.toString(), {
      headers: { Authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!offRes.ok) throw new Error(`Amadeus hotel offers ${offRes.status}`);
    const offData = await offRes.json() as { data?: AmadeusHotelOffer[] };

    const nights = Math.max(
      1,
      Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86400000)
    );

    return (offData.data ?? [])
      .filter(h => (h.offers ?? []).length > 0)
      .map(h => {
        const offer = h.offers![0];
        const nightly = parseFloat(offer.price?.total ?? '0') / nights;
        return {
          id:           `amadeus_${h.hotel.hotelId}`,
          provider:     'amadeus',
          name:         h.hotel.name ?? 'Hotel',
          location:     h.hotel.address?.lines?.join(', ') ?? params.destination,
          city:         h.hotel.address?.cityName ?? params.destination,
          stars:        parseInt(h.hotel.rating ?? '3', 10),
          pricePerNight: nightly,
          totalPrice:   parseFloat(offer.price?.total ?? '0'),
          currency:     offer.price?.currency ?? 'USD',
          image:        h.hotel.media?.[0]?.uri ?? `https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop`,
          rating:       parseFloat(h.hotel.rating ?? '7') * 2, // convert 1-5 stars → 0-10
          amenities:    (h.hotel.amenities ?? []).slice(0, 6),
          cancellation: offer.policies?.cancellation?.description?.text ?? 'Check provider',
          checkIn:      params.checkIn,
          checkOut:     params.checkOut,
          bookingToken: offer.id,
        };
      })
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 6);
  }
}
