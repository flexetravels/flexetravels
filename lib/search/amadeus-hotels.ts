// ─── Amadeus Hotel Provider ────────────────────────────────────────────────────
// Replaces LiteAPI for hotel BOOKING (which kept failing sandbox validation).
// Uses the same Amadeus credentials already wired for flights.
//
// Flow:
//   1. GET /v1/reference-data/locations/hotels/by-city → hotel IDs
//   2. GET /v3/shopping/hotel-offers?hotelIds=...      → rates
//   3. POST /v1/booking/hotel-orders                   → confirmed booking
//
// bookingToken format: "amadeus_hotel_<offerId>"
// book-trip/route.ts detects this prefix and calls bookAmadeusHotel().

import type { HotelSearchParams, NormalizedHotel } from './types';

const AMADEUS_BASE = process.env.AMADEUS_BASE_URL || 'https://api.amadeus.com';

// ─── Airport → Amadeus IATA city code (where they differ) ─────────────────────
// Amadeus hotel-by-city uses city codes, not airport codes.
const AIRPORT_TO_CITY: Record<string, string> = {
  // North America — major hubs where airport ≠ city code
  'JFK': 'NYC', 'EWR': 'NYC', 'LGA': 'NYC',
  'ORD': 'CHI', 'MDW': 'CHI',
  'YYZ': 'YTO', 'YUL': 'YMQ',
  'IAD': 'WAS', 'DCA': 'WAS',
  'SFO': 'SFO', 'OAK': 'SFO',
  // Europe
  'LHR': 'LON', 'LGW': 'LON', 'STN': 'LON', 'LTN': 'LON',
  'CDG': 'PAR', 'ORY': 'PAR',
  'FCO': 'ROM', 'CIA': 'ROM',
  'MXP': 'MIL', 'LIN': 'MIL',
  'FRA': 'FRA', 'MUC': 'MUC',
  'AMS': 'AMS',
  // Asia
  'NRT': 'TYO', 'HND': 'TYO',
  'ICN': 'SEL', 'GMP': 'SEL',
  'PEK': 'BJS', 'PKX': 'BJS',
  'PVG': 'SHA', 'SHA': 'SHA',
  'BOM': 'BOM', 'DEL': 'DEL',
  // Most popular tourist destinations map 1-to-1 (CUN, MIA, LAX, etc.)
};

function toCityCode(iataAirport: string): string {
  const upper = iataAirport.toUpperCase().trim();
  return AIRPORT_TO_CITY[upper] ?? upper;
}

// ─── Amenity code → label ──────────────────────────────────────────────────────
const AMENITY_MAP: Record<string, string> = {
  WIFI: 'WiFi', SWIMMING_POOL: 'Pool', FITNESS_CENTER: 'Gym', SPA: 'Spa',
  RESTAURANT: 'Restaurant', BAR: 'Bar', PARKING: 'Parking', AIR_CONDITIONING: 'Air Conditioning',
  BUSINESS_CENTER: 'Business Centre', CONCIERGE: 'Concierge', ROOM_SERVICE: 'Room Service',
  LAUNDRY_SERVICE: 'Laundry', AIRPORT_SHUTTLE: 'Airport Shuttle', PETS_ALLOWED: 'Pets OK',
  KITCHEN: 'Kitchen', MINIBAR: 'Minibar', MEETING_ROOMS: 'Meeting Rooms',
};

// ─── Token cache (shared — same token works for hotels + flights) ──────────────
let _token: { value: string; expiresAt: number } | null = null;

async function getAmadeusToken(clientId: string, clientSecret: string): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 30_000) return _token.value;
  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    signal:  AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Amadeus auth ${res.status}`);
  const d = await res.json() as { access_token: string; expires_in: number };
  _token = { value: d.access_token, expiresAt: Date.now() + d.expires_in * 1_000 };
  return _token.value;
}

// ─── Amadeus hotel search response types ──────────────────────────────────────

interface AmadeusHotelListItem {
  hotelId:    string;
  name?:      string;
  iataCode?:  string;
  address?:   { countryCode?: string; cityName?: string };
  rating?:    string;   // "3", "4", "5"
  amenities?: string[];
  media?:     Array<{ uri: string; category?: string }>;
  latitude?:  number;
  longitude?: number;
  distance?:  { value?: number; unit?: string };
}

interface AmadeusHotelOffer {
  id:           string;
  checkInDate:  string;
  checkOutDate: string;
  boardType?:   string;
  room?: {
    type?:          string;
    typeEstimated?: { category?: string; beds?: number; bedType?: string };
    description?:   { text?: string };
  };
  price: {
    currency:     string;
    base?:        string;
    total:        string;
    variations?:  { average?: { base?: string } };
  };
  policies?: {
    cancellations?: Array<{ type?: string; deadline?: string; amount?: string }>;
    paymentType?:   string;
  };
  self?: string;
}

interface AmadeusHotelResult {
  type:       string;
  hotel:      { hotelId: string; name?: string; cityCode?: string; rating?: string; latitude?: number; longitude?: number; amenities?: string[]; media?: Array<{ uri: string }> };
  available:  boolean;
  offers?:    AmadeusHotelOffer[];
  self?:      string;
}

// ─── Hotel search result cache ─────────────────────────────────────────────────
const HOTEL_CACHE = new Map<string, { data: NormalizedHotel[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1_000; // 30 min

// ─── Main search function ──────────────────────────────────────────────────────

export async function searchAmadeusHotels(
  params:       HotelSearchParams,
  clientId:     string,
  clientSecret: string,
): Promise<NormalizedHotel[]> {
  const cityCode = toCityCode(params.destination);
  const cacheKey = `${cityCode}::${params.checkIn}::${params.checkOut}::${params.adults ?? 2}`;
  const cached = HOTEL_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log('[AmadeusHotels] cache hit for', cacheKey);
    return cached.data;
  }

  const token = await getAmadeusToken(clientId, clientSecret);
  const nights = Math.max(1, Math.round(
    (new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86_400_000
  ));

  // ── Step 1: hotel IDs for the city ──────────────────────────────────────────
  const listUrl = new URL(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city`);
  listUrl.searchParams.set('cityCode', cityCode);
  listUrl.searchParams.set('radius', '5');
  listUrl.searchParams.set('radiusUnit', 'KM');
  listUrl.searchParams.set('hotelSource', 'ALL');
  if (!params.stars || params.stars <= 3) {
    listUrl.searchParams.set('ratings', '3,4,5');
  } else {
    listUrl.searchParams.set('ratings', '4,5');
  }

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal:  AbortSignal.timeout(8_000),
  });
  if (!listRes.ok) {
    const txt = await listRes.text();
    throw new Error(`Amadeus hotel list ${listRes.status} (${cityCode}): ${txt.slice(0, 200)}`);
  }
  const listData = await listRes.json() as { data?: AmadeusHotelListItem[] };
  const hotelList = (listData.data ?? []).slice(0, 25);
  if (hotelList.length === 0) throw new Error(`No hotels found for city code ${cityCode}`);

  const hotelInfoMap = new Map(hotelList.map(h => [h.hotelId, h]));
  const hotelIds = hotelList.map(h => h.hotelId).join(',');

  // ── Step 2: live offers ──────────────────────────────────────────────────────
  const offersUrl = new URL(`${AMADEUS_BASE}/v3/shopping/hotel-offers`);
  offersUrl.searchParams.set('hotelIds',      hotelIds);
  offersUrl.searchParams.set('adults',        String(params.adults ?? 2));
  offersUrl.searchParams.set('checkInDate',   params.checkIn);
  offersUrl.searchParams.set('checkOutDate',  params.checkOut);
  offersUrl.searchParams.set('roomQuantity',  '1');
  offersUrl.searchParams.set('bestRateOnly',  'true');
  offersUrl.searchParams.set('currency',      'USD');
  offersUrl.searchParams.set('paymentPolicy', 'NONE');

  const offersRes = await fetch(offersUrl.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal:  AbortSignal.timeout(20_000),
  });
  if (!offersRes.ok) {
    const txt = await offersRes.text();
    throw new Error(`Amadeus hotel offers ${offersRes.status}: ${txt.slice(0, 200)}`);
  }
  const offersData = await offersRes.json() as { data?: AmadeusHotelResult[] };

  const normalized: NormalizedHotel[] = [];

  for (const result of offersData.data ?? []) {
    if (!result.available || !result.offers?.length) continue;

    const hotel    = result.hotel;
    const offer    = result.offers[0];
    const info     = hotelInfoMap.get(hotel.hotelId);

    const totalPrice    = parseFloat(offer.price.total);
    const pricePerNight = totalPrice / nights;
    if (isNaN(totalPrice) || totalPrice <= 0) continue;
    if (params.maxPrice && pricePerNight > params.maxPrice) continue;

    const stars = parseInt(hotel.rating ?? info?.rating ?? '3', 10) || 3;
    if (params.stars && stars < params.stars) continue;

    // Cancellation policy
    const cancellation = offer.policies?.cancellations?.[0];
    const refundable   = cancellation?.type !== 'NON_REFUNDABLE' && cancellation?.type !== 'FULL_CHARGE';

    // Amenities
    const rawAmenities = hotel.amenities ?? info?.amenities ?? [];
    const amenities    = rawAmenities.slice(0, 6).map(a => AMENITY_MAP[a] ?? a);
    if (amenities.length === 0) amenities.push('WiFi', 'Air Conditioning');

    // Image: first hotel media, fall back to Unsplash placeholder
    const image = hotel.media?.[0]?.uri ?? info?.media?.[0]?.uri ?? '';

    // City from hotel data
    const city = hotel.cityCode ?? info?.address?.cityName ?? params.destination;

    normalized.push({
      id:            hotel.hotelId,
      provider:      'amadeus',
      name:          hotel.name ?? info?.name ?? `Hotel ${hotel.hotelId}`,
      location:      city,
      city,
      stars,
      pricePerNight: Math.round(pricePerNight * 100) / 100,
      totalPrice:    Math.round(totalPrice * 100) / 100,
      currency:      offer.price.currency,
      image,
      images:        image ? [image] : [],
      rating:        6.5 + (stars - 3) * 0.6,  // 5★ ≈ 8.7, 3★ ≈ 6.5
      amenities,
      cancellation:  refundable ? 'Free cancellation' : 'Non-refundable',
      checkIn:       offer.checkInDate,
      checkOut:      offer.checkOutDate,
      // Prefix lets book-trip route detect Amadeus vs LiteAPI
      bookingToken:  `amadeus_hotel_${offer.id}`,
      isSample:      false,
    });
  }

  const results = normalized
    .sort((a, b) => a.pricePerNight - b.pricePerNight)
    .slice(0, 6);

  HOTEL_CACHE.set(cacheKey, { data: results, ts: Date.now() });
  if (HOTEL_CACHE.size > 100) {
    const oldest = [...HOTEL_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    HOTEL_CACHE.delete(oldest[0]);
  }
  console.log(`[AmadeusHotels] ${results.length} hotels for ${cityCode} (${params.checkIn}→${params.checkOut})`);
  return results;
}

// ─── Hotel booking ─────────────────────────────────────────────────────────────

export interface AmadeusHotelBookResult {
  success:    boolean;
  bookingRef?: string;
  hotelName?:  string;
  checkIn?:    string;
  checkOut?:   string;
  totalAmount?: string;
  currency?:   string;
  error?:      string;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export async function bookAmadeusHotel(params: {
  offerId:      string;          // raw offer ID (without 'amadeus_hotel_' prefix)
  passengers:   Array<{ firstName: string; lastName: string; email: string; phone: string; dateOfBirth: string }>;
  clientId:     string;
  clientSecret: string;
}): Promise<AmadeusHotelBookResult> {
  const token = await getAmadeusToken(params.clientId, params.clientSecret);

  const body = {
    data: {
      offerId: params.offerId,
      guests:  params.passengers.map((p, i) => ({
        id:      i + 1,
        name:    { title: 'MR', firstName: p.firstName, lastName: p.lastName },
        contact: {
          emailAddress: p.email,
          phone:        normalizePhone(p.phone),
        },
      })),
      payments: [{
        id:     1,
        method: 'creditCard',
        card:   {
          vendorCode:  'VI',
          cardNumber:  '4111111111111111',  // Amadeus test card
          expiryDate:  '2028-12',           // YYYY-MM format
        },
      }],
    },
  };

  console.log('[AmadeusHotelBook] offerId:', params.offerId, 'guests:', params.passengers.length);

  const res = await fetch(`${AMADEUS_BASE}/v1/booking/hotel-orders`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('[AmadeusHotelBook] failed', res.status, txt.slice(0, 400));
    return { success: false, error: `Hotel booking failed (${res.status}): ${txt.slice(0, 300)}` };
  }

  const data = await res.json() as {
    data?: {
      type?:              string;
      id?:                string;
      providerConfirmationId?: string;
      associatedRecords?: Array<{ reference?: string; originSystemCode?: string }>;
      hotel?:             { hotelId?: string; name?: string; checkInDate?: string; checkOutDate?: string };
      totalPrice?:        { total?: string; currency?: string };
    };
  };

  // Booking reference: prefer providerConfirmationId, then id, then first associatedRecord
  const bookingRef =
    data.data?.providerConfirmationId ??
    data.data?.associatedRecords?.[0]?.reference ??
    data.data?.id ??
    'CONFIRMED';

  console.log('[AmadeusHotelBook] success! bookingRef:', bookingRef);

  return {
    success:     true,
    bookingRef,
    hotelName:   data.data?.hotel?.name,
    checkIn:     data.data?.hotel?.checkInDate,
    checkOut:    data.data?.hotel?.checkOutDate,
    totalAmount: data.data?.totalPrice?.total,
    currency:    data.data?.totalPrice?.currency ?? 'USD',
  };
}

// ─── Provider class (plug into aggregator) ────────────────────────────────────

export class AmadeusHotelProvider {
  readonly name = 'amadeus-hotels';
  private readonly clientId:     string;
  private readonly clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
  }

  // Hotels only — aggregateFlights filters this provider out by name
  async searchFlights(): Promise<[]> { return []; }

  async searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]> {
    return searchAmadeusHotels(params, this.clientId, this.clientSecret);
  }
}
