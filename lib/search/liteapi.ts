// ─── LiteAPI Hotel Provider ────────────────────────────────────────────────────
// Docs: https://docs.liteapi.travel/reference
// v3.0 REST API — real-time hotel rates from 1M+ properties worldwide
// Sandbox key starts with "sand_", production with "prod_"
// Rate limits: 10 req/s sandbox, 100 req/s production

import type {
  SearchProvider, FlightSearchParams, HotelSearchParams,
  NormalizedFlight, NormalizedHotel,
} from './types';

const LITEAPI_BASE = 'https://api.liteapi.travel/v3.0';

// ─── City → Country code mapping ──────────────────────────────────────────────
// Covers all major destinations from North American travellers
const CITY_COUNTRY: Record<string, string> = {
  // USA
  'new york': 'US', 'nyc': 'US', 'miami': 'US', 'los angeles': 'US', 'la': 'US',
  'chicago': 'US', 'dallas': 'US', 'houston': 'US', 'san francisco': 'US',
  'seattle': 'US', 'denver': 'US', 'boston': 'US', 'atlanta': 'US',
  'las vegas': 'US', 'orlando': 'US', 'phoenix': 'US', 'portland': 'US',
  'minneapolis': 'US', 'detroit': 'US', 'washington': 'US', 'dc': 'US',
  'nashville': 'US', 'austin': 'US', 'new orleans': 'US', 'san diego': 'US',
  'honolulu': 'US', 'tampa': 'US', 'charlotte': 'US', 'philadelphia': 'US',
  'salt lake city': 'US', 'sacramento': 'US', 'san jose': 'US', 'raleigh': 'US',
  // Canada
  'toronto': 'CA', 'vancouver': 'CA', 'montreal': 'CA', 'calgary': 'CA',
  'ottawa': 'CA', 'winnipeg': 'CA', 'edmonton': 'CA', 'halifax': 'CA',
  'victoria': 'CA', 'kelowna': 'CA', 'quebec city': 'CA', 'quebec': 'CA',
  'niagara falls': 'CA', 'banff': 'CA', 'whistler': 'CA',
  // Mexico
  'cancun': 'MX', 'mexico city': 'MX', 'playa del carmen': 'MX', 'cabo': 'MX',
  'cabo san lucas': 'MX', 'puerto vallarta': 'MX', 'guadalajara': 'MX',
  'oaxaca': 'MX', 'tulum': 'MX', 'merida': 'MX', 'san jose del cabo': 'MX',
  // Caribbean
  'punta cana': 'DO', 'santo domingo': 'DO',
  'nassau': 'BS', 'paradise island': 'BS',
  'montego bay': 'JM', 'kingston': 'JM', 'negril': 'JM', 'ocho rios': 'JM',
  'bridgetown': 'BB', 'barbados': 'BB',
  'san juan': 'PR', 'puerto rico': 'PR',
  'havana': 'CU', 'varadero': 'CU',
  // Europe
  'london': 'GB', 'edinburgh': 'GB', 'manchester': 'GB',
  'paris': 'FR', 'nice': 'FR', 'lyon': 'FR', 'marseille': 'FR',
  'rome': 'IT', 'milan': 'IT', 'venice': 'IT', 'florence': 'IT', 'naples': 'IT',
  'barcelona': 'ES', 'madrid': 'ES', 'seville': 'ES', 'malaga': 'ES', 'ibiza': 'ES',
  'amsterdam': 'NL',
  'berlin': 'DE', 'munich': 'DE', 'frankfurt': 'DE', 'hamburg': 'DE',
  'vienna': 'AT', 'innsbruck': 'AT',
  'prague': 'CZ',
  'budapest': 'HU',
  'lisbon': 'PT', 'porto': 'PT', 'algarve': 'PT',
  'dublin': 'IE',
  'athens': 'GR', 'santorini': 'GR', 'mykonos': 'GR',
  'zurich': 'CH', 'geneva': 'CH', 'bern': 'CH', 'interlaken': 'CH',
  'brussels': 'BE',
  'copenhagen': 'DK',
  'stockholm': 'SE',
  'oslo': 'NO',
  'helsinki': 'FI',
  'warsaw': 'PL', 'krakow': 'PL',
  'reykjavik': 'IS',
  // Asia
  'tokyo': 'JP', 'osaka': 'JP', 'kyoto': 'JP',
  'bangkok': 'TH', 'phuket': 'TH', 'pattaya': 'TH', 'chiang mai': 'TH',
  'singapore': 'SG',
  'bali': 'ID', 'jakarta': 'ID', 'ubud': 'ID',
  'dubai': 'AE', 'abu dhabi': 'AE',
  'hong kong': 'HK',
  'seoul': 'KR', 'busan': 'KR',
  'beijing': 'CN', 'shanghai': 'CN', 'guangzhou': 'CN',
  'mumbai': 'IN', 'delhi': 'IN', 'jaipur': 'IN', 'goa': 'IN',
  'istanbul': 'TR',
  'maldives': 'MV', 'male': 'MV',
  'kathmandu': 'NP',
  // Oceania
  'sydney': 'AU', 'melbourne': 'AU', 'brisbane': 'AU', 'cairns': 'AU', 'perth': 'AU',
  'auckland': 'NZ', 'queenstown': 'NZ', 'christchurch': 'NZ',
  // Africa & Middle East
  'cairo': 'EG', 'luxor': 'EG', 'sharm el sheikh': 'EG',
  'marrakech': 'MA', 'casablanca': 'MA',
  'cape town': 'ZA', 'johannesburg': 'ZA',
  'nairobi': 'KE', 'mombasa': 'KE',
};

// IATA code → city + country (for when destination is passed as airport code)
const IATA_TO_CITY: Record<string, { city: string; countryCode: string }> = {
  'CUN': { city: 'Cancun', countryCode: 'MX' },
  'JFK': { city: 'New York', countryCode: 'US' },
  'EWR': { city: 'New York', countryCode: 'US' },
  'LAX': { city: 'Los Angeles', countryCode: 'US' },
  'ORD': { city: 'Chicago', countryCode: 'US' },
  'MIA': { city: 'Miami', countryCode: 'US' },
  'SFO': { city: 'San Francisco', countryCode: 'US' },
  'LAS': { city: 'Las Vegas', countryCode: 'US' },
  'MCO': { city: 'Orlando', countryCode: 'US' },
  'SEA': { city: 'Seattle', countryCode: 'US' },
  'BOS': { city: 'Boston', countryCode: 'US' },
  'ATL': { city: 'Atlanta', countryCode: 'US' },
  'DEN': { city: 'Denver', countryCode: 'US' },
  'DFW': { city: 'Dallas', countryCode: 'US' },
  'IAD': { city: 'Washington', countryCode: 'US' },
  'PHL': { city: 'Philadelphia', countryCode: 'US' },
  'PHX': { city: 'Phoenix', countryCode: 'US' },
  'SAN': { city: 'San Diego', countryCode: 'US' },
  'HNL': { city: 'Honolulu', countryCode: 'US' },
  'MSY': { city: 'New Orleans', countryCode: 'US' },
  'AUS': { city: 'Austin', countryCode: 'US' },
  'BNA': { city: 'Nashville', countryCode: 'US' },
  'YYZ': { city: 'Toronto', countryCode: 'CA' },
  'YVR': { city: 'Vancouver', countryCode: 'CA' },
  'YUL': { city: 'Montreal', countryCode: 'CA' },
  'YYC': { city: 'Calgary', countryCode: 'CA' },
  'YOW': { city: 'Ottawa', countryCode: 'CA' },
  'LHR': { city: 'London', countryCode: 'GB' },
  'CDG': { city: 'Paris', countryCode: 'FR' },
  'FCO': { city: 'Rome', countryCode: 'IT' },
  'BCN': { city: 'Barcelona', countryCode: 'ES' },
  'AMS': { city: 'Amsterdam', countryCode: 'NL' },
  'NRT': { city: 'Tokyo', countryCode: 'JP' },
  'BKK': { city: 'Bangkok', countryCode: 'TH' },
  'SIN': { city: 'Singapore', countryCode: 'SG' },
  'DXB': { city: 'Dubai', countryCode: 'AE' },
  'SYD': { city: 'Sydney', countryCode: 'AU' },
  'GRU': { city: 'Sao Paulo', countryCode: 'BR' },
  'PUJ': { city: 'Punta Cana', countryCode: 'DO' },
  'MBJ': { city: 'Montego Bay', countryCode: 'JM' },
  'NAS': { city: 'Nassau', countryCode: 'BS' },
};

function toTitleCase(str: string): string {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function resolveCityCountry(destination: string): { city: string; countryCode: string } {
  const upper = destination.toUpperCase().trim();
  // Handle IATA codes
  if (/^[A-Z]{3}$/.test(upper) && IATA_TO_CITY[upper]) {
    return IATA_TO_CITY[upper];
  }

  // Handle city name matching (longest match wins to handle "playa del carmen" over "carmen")
  const lower = destination.toLowerCase().trim();
  let best: [string, string] | null = null;
  for (const [key, code] of Object.entries(CITY_COUNTRY)) {
    if (lower === key || lower.startsWith(key + ' ') || lower.endsWith(' ' + key) || lower.includes(key)) {
      if (!best || key.length > best[0].length) {
        best = [key, code];
      }
    }
  }
  if (best) return { city: toTitleCase(best[0]), countryCode: best[1] };

  // Default to US
  return { city: destination, countryCode: 'US' };
}

// ─── LiteAPI raw response types ────────────────────────────────────────────────
interface LiteHotelListItem {
  id:          string;
  name:        string;
  starRating?: number;
  main_photo?: string;
  thumbnail?:  string;
  location?:   { latitute?: number; longitude?: number };
}

interface LiteRate {
  rateId?: string;
  name?:   string;
  retailRate?: {
    total?: Array<{ amount: number; currency: string }>;
  };
  boardType?:  string;
  boardName?:  string;
  cancellationPolicies?: { refundableTag?: string };
}

interface LiteRoomType {
  offerId?: string;
  name?:    string;
  rates?:   LiteRate[];
}

interface LiteRateHotel {
  hotelId:    string;
  roomTypes?: LiteRoomType[];
}

// ─── LiteAPI Provider ──────────────────────────────────────────────────────────
export class LiteApiProvider implements SearchProvider {
  readonly name = 'liteapi';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get headers(): HeadersInit {
    return {
      'X-API-Key':    this.apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };
  }

  // LiteAPI is hotels-only
  async searchFlights(_params: FlightSearchParams): Promise<NormalizedFlight[]> {
    return [];
  }

  async searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]> {
    const { city, countryCode } = resolveCityCountry(params.destination);
    const nights = Math.max(
      1,
      Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86400000)
    );

    // ── Step 1: Fetch hotel list for the city ──────────────────────────────────
    const listUrl =
      `${LITEAPI_BASE}/data/hotels?countryCode=${countryCode}` +
      `&cityName=${encodeURIComponent(city)}&limit=20`;

    const listRes = await fetch(listUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!listRes.ok) {
      const txt = await listRes.text();
      throw new Error(`LiteAPI hotels list ${listRes.status}: ${txt.slice(0, 200)}`);
    }

    const listData = await listRes.json() as { data?: LiteHotelListItem[] };
    const hotelList = listData.data ?? [];

    if (hotelList.length === 0) {
      throw new Error(`No hotels found for ${city}, ${countryCode} in LiteAPI`);
    }

    // Build a lookup map for hotel details by ID
    const hotelInfoMap = new Map(hotelList.map(h => [h.id, h]));
    const hotelIds = hotelList.map(h => h.id);

    // ── Step 2: Fetch live rates ────────────────────────────────────────────────
    const ratesRes = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        hotelIds,
        checkinDate:       params.checkIn,
        checkoutDate:      params.checkOut,
        occupancies:       [{ adults: params.adults }],
        currency:          'USD',
        guestNationality:  countryCode === 'CA' ? 'CA' : 'US',
      }),
      signal: AbortSignal.timeout(35_000),
    });

    if (!ratesRes.ok) {
      const txt = await ratesRes.text();
      throw new Error(`LiteAPI rates ${ratesRes.status}: ${txt.slice(0, 200)}`);
    }

    const ratesData = await ratesRes.json() as { data?: LiteRateHotel[] };
    const normalized: NormalizedHotel[] = [];

    for (const rateHotel of ratesData.data ?? []) {
      const info = hotelInfoMap.get(rateHotel.hotelId);
      if (!info) continue;

      // Pick the cheapest available rate across all room types
      const allRates: LiteRate[] = (rateHotel.roomTypes ?? []).flatMap(rt => rt.rates ?? []);
      if (allRates.length === 0) continue;

      const cheapest = allRates.reduce<LiteRate | null>((best, rate) => {
        const amt = rate.retailRate?.total?.[0]?.amount ?? 0;
        const bestAmt = best?.retailRate?.total?.[0]?.amount ?? Infinity;
        return amt > 0 && amt < bestAmt ? rate : best;
      }, null);

      if (!cheapest) continue;

      const totalPrice = cheapest.retailRate?.total?.[0]?.amount ?? 0;
      if (totalPrice <= 0) continue;

      const pricePerNight = totalPrice / nights;

      // Apply user filters
      if (params.maxPrice && pricePerNight > params.maxPrice) continue;
      const stars = info.starRating ?? 3;
      if (params.stars && stars < params.stars) continue;

      const refundable = cheapest.cancellationPolicies?.refundableTag === 'FULLY_REFUNDABLE';

      normalized.push({
        id:            rateHotel.hotelId,
        provider:      'liteapi',
        name:          info.name,
        location:      city,
        city:          city,
        stars,
        pricePerNight: Math.round(pricePerNight * 100) / 100,
        totalPrice:    Math.round(totalPrice * 100) / 100,
        currency:      cheapest.retailRate?.total?.[0]?.currency ?? 'USD',
        image:         info.main_photo ?? info.thumbnail ?? '',
        images:        info.main_photo ? [info.main_photo] : [],
        rating:        7.5 + (stars - 3) * 0.4, // Approximate: 5-star ≈ 8.3, 3-star ≈ 7.5
        amenities:     ['WiFi', 'Air Conditioning', ...(stars >= 4 ? ['Pool', 'Gym'] : [])],
        cancellation:  refundable ? 'Free cancellation' : 'Non-refundable',
        checkIn:       params.checkIn,
        checkOut:      params.checkOut,
        bookingToken:  cheapest.rateId,  // rateId used for prebook step
        isSample:      false,
      });
    }

    return normalized
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 6);
  }
}

// ─── Pre-booking helper (used by bookHotel tool in chat route) ─────────────────
export interface LiteApiPrebookResult {
  success:           boolean;
  prebookId?:        string;
  hotelId?:          string;
  confirmedTotal?:   number;
  currency?:         string;
  cancellationType?: string;
  cancellationDeadline?: string;
  error?:            string;
}

export async function liteApiPrebook(
  rateId: string,
  guestNationality = 'US',
  apiKey?: string
): Promise<LiteApiPrebookResult> {
  const key = apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) {
    return { success: false, error: 'LITEAPI_KEY not configured — hotel booking unavailable' };
  }

  const res = await fetch(`${LITEAPI_BASE}/rates/prebook`, {
    method: 'POST',
    headers: {
      'X-API-Key':    key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({ rateId, guestNationality }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: `Prebook failed ${res.status}: ${txt.slice(0, 200)}` };
  }

  const data = await res.json() as {
    data?: {
      prebookId?:  string;
      hotelId?:    string;
      currency?:   string;
      price?:      { total?: number; currency?: string };
      cancellationPolicies?: { type?: string; deadline?: string };
    };
  };

  return {
    success:             true,
    prebookId:           data.data?.prebookId,
    hotelId:             data.data?.hotelId,
    confirmedTotal:      data.data?.price?.total,
    currency:            data.data?.price?.currency ?? data.data?.currency ?? 'USD',
    cancellationType:    data.data?.cancellationPolicies?.type,
    cancellationDeadline: data.data?.cancellationPolicies?.deadline,
  };
}

// ─── Book helper (sandbox uses test card; production will use Stripe token) ────
export interface LiteApiBookResult {
  success:      boolean;
  bookingId?:   string;
  status?:      string;
  totalAmount?: number;
  currency?:    string;
  hotelName?:   string;
  address?:     string;
  checkIn?:     string;
  checkOut?:    string;
  error?:       string;
}

export async function liteApiBook(params: {
  prebookId:          string;
  guestFirstName:     string;
  guestLastName:      string;
  guestEmail:         string;
  apiKey?:            string;
}): Promise<LiteApiBookResult> {
  const key = params.apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) {
    return { success: false, error: 'LITEAPI_KEY not configured' };
  }

  // Sandbox test card — in production this will be replaced by a Stripe payment token
  const payment = {
    holderName: `${params.guestFirstName} ${params.guestLastName}`,
    number:     '4242424242424242',
    expireDate: '12/28',
    cvc:        '100',
    method:     'CREDIT_CARD',
  };

  const res = await fetch(`${LITEAPI_BASE}/rates/book`, {
    method: 'POST',
    headers: {
      'X-API-Key':    key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({
      prebookId: params.prebookId,
      guestInfo: {
        guestFirstName: params.guestFirstName,
        guestLastName:  params.guestLastName,
        guestEmail:     params.guestEmail,
      },
      payment,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { success: false, error: `Booking failed ${res.status}: ${txt.slice(0, 300)}` };
  }

  const data = await res.json() as {
    data?: {
      bookingId?:  string;
      status?:     string;
      price?:      { total?: number; currency?: string };
      hotel?:      { name?: string; address?: string };
      checkIn?:    string;
      checkOut?:   string;
    };
  };

  return {
    success:     true,
    bookingId:   data.data?.bookingId,
    status:      data.data?.status,
    totalAmount: data.data?.price?.total,
    currency:    data.data?.price?.currency ?? 'USD',
    hotelName:   data.data?.hotel?.name,
    address:     data.data?.hotel?.address,
    checkIn:     data.data?.checkIn,
    checkOut:    data.data?.checkOut,
  };
}
