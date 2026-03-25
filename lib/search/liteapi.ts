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

// ─── Hotel search cache (in-process, 30-min TTL per city+dates+guests) ─────────
// Avoids hitting LiteAPI's slow rates endpoint on every message turn.
const HOTEL_CACHE = new Map<string, { data: NormalizedHotel[]; ts: number }>();
const HOTEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
  // South America
  'lima': 'PE', 'cusco': 'PE', 'cuzco': 'PE', 'machu picchu': 'PE', 'arequipa': 'PE',
  'buenos aires': 'AR', 'bariloche': 'AR', 'mendoza': 'AR',
  'rio de janeiro': 'BR', 'sao paulo': 'BR', 'florianopolis': 'BR', 'salvador': 'BR',
  'bogota': 'CO', 'cartagena': 'CO', 'medellin': 'CO',
  'santiago': 'CL', 'valparaiso': 'CL',
  'quito': 'EC', 'galapagos': 'EC',
  'montevideo': 'UY',
  'la paz': 'BO',
  'asuncion': 'PY',
  // Africa & Middle East
  'cairo': 'EG', 'luxor': 'EG', 'sharm el sheikh': 'EG',
  'marrakech': 'MA', 'casablanca': 'MA',
  'cape town': 'ZA', 'johannesburg': 'ZA',
  'nairobi': 'KE', 'mombasa': 'KE',
  'accra': 'GH', 'lagos': 'NG', 'dakar': 'SN',
  'tel aviv': 'IL', 'jerusalem': 'IL',
  'amman': 'JO', 'petra': 'JO',
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
  'YYZ': { city: 'Toronto',       countryCode: 'CA' },
  'YVR': { city: 'Vancouver',     countryCode: 'CA' },
  'YUL': { city: 'Montreal',      countryCode: 'CA' },
  'YYC': { city: 'Calgary',       countryCode: 'CA' },
  'YOW': { city: 'Ottawa',        countryCode: 'CA' },
  'YEG': { city: 'Edmonton',      countryCode: 'CA' },
  'YHZ': { city: 'Halifax',       countryCode: 'CA' },
  'YXE': { city: 'Saskatoon',     countryCode: 'CA' },
  'YQR': { city: 'Regina',        countryCode: 'CA' },
  'YWG': { city: 'Winnipeg',      countryCode: 'CA' },
  'LHR': { city: 'London',        countryCode: 'GB' },
  'LGW': { city: 'London',        countryCode: 'GB' },
  'EDI': { city: 'Edinburgh',     countryCode: 'GB' },
  'CDG': { city: 'Paris',         countryCode: 'FR' },
  'FCO': { city: 'Rome',          countryCode: 'IT' },
  'VCE': { city: 'Venice',        countryCode: 'IT' },
  'MXP': { city: 'Milan',         countryCode: 'IT' },
  'BCN': { city: 'Barcelona',     countryCode: 'ES' },
  'MAD': { city: 'Madrid',        countryCode: 'ES' },
  'AMS': { city: 'Amsterdam',     countryCode: 'NL' },
  'VIE': { city: 'Vienna',        countryCode: 'AT' },
  'PRG': { city: 'Prague',        countryCode: 'CZ' },
  'BUD': { city: 'Budapest',      countryCode: 'HU' },
  'LIS': { city: 'Lisbon',        countryCode: 'PT' },
  'DUB': { city: 'Dublin',        countryCode: 'IE' },
  'ATH': { city: 'Athens',        countryCode: 'GR' },
  'JTR': { city: 'Santorini',     countryCode: 'GR' },
  'ZRH': { city: 'Zurich',        countryCode: 'CH' },
  'CPH': { city: 'Copenhagen',    countryCode: 'DK' },
  'ARN': { city: 'Stockholm',     countryCode: 'SE' },
  'OSL': { city: 'Oslo',          countryCode: 'NO' },
  'HEL': { city: 'Helsinki',      countryCode: 'FI' },
  'KEF': { city: 'Reykjavik',     countryCode: 'IS' },
  'WAW': { city: 'Warsaw',        countryCode: 'PL' },
  'KRK': { city: 'Krakow',        countryCode: 'PL' },
  'NRT': { city: 'Tokyo',         countryCode: 'JP' },
  'HND': { city: 'Tokyo',         countryCode: 'JP' },
  'KIX': { city: 'Osaka',         countryCode: 'JP' },
  'BKK': { city: 'Bangkok',       countryCode: 'TH' },
  'HKT': { city: 'Phuket',        countryCode: 'TH' },
  'CNX': { city: 'Chiang Mai',    countryCode: 'TH' },
  'SIN': { city: 'Singapore',     countryCode: 'SG' },
  'DPS': { city: 'Bali',          countryCode: 'ID' },
  'DXB': { city: 'Dubai',         countryCode: 'AE' },
  'AUH': { city: 'Abu Dhabi',     countryCode: 'AE' },
  'HKG': { city: 'Hong Kong',     countryCode: 'HK' },
  'ICN': { city: 'Seoul',         countryCode: 'KR' },
  'IST': { city: 'Istanbul',      countryCode: 'TR' },
  'MLE': { city: 'Maldives',      countryCode: 'MV' },
  'SYD': { city: 'Sydney',        countryCode: 'AU' },
  'MEL': { city: 'Melbourne',     countryCode: 'AU' },
  'BNE': { city: 'Brisbane',      countryCode: 'AU' },
  'AKL': { city: 'Auckland',      countryCode: 'NZ' },
  'ZQN': { city: 'Queenstown',    countryCode: 'NZ' },
  'GRU': { city: 'Sao Paulo',      countryCode: 'BR' },
  'GIG': { city: 'Rio de Janeiro', countryCode: 'BR' },
  'SSA': { city: 'Salvador',       countryCode: 'BR' },
  'FLN': { city: 'Florianopolis',  countryCode: 'BR' },
  'EZE': { city: 'Buenos Aires',   countryCode: 'AR' },
  'AEP': { city: 'Buenos Aires',   countryCode: 'AR' },
  'BRC': { city: 'Bariloche',      countryCode: 'AR' },
  'MDZ': { city: 'Mendoza',        countryCode: 'AR' },
  'LIM': { city: 'Lima',           countryCode: 'PE' },
  'CUZ': { city: 'Cusco',          countryCode: 'PE' },  // Gateway to Machu Picchu
  'BOG': { city: 'Bogota',         countryCode: 'CO' },
  'CTG': { city: 'Cartagena',      countryCode: 'CO' },
  'MDE': { city: 'Medellin',       countryCode: 'CO' },
  'SCL': { city: 'Santiago',       countryCode: 'CL' },
  'UIO': { city: 'Quito',          countryCode: 'EC' },
  'GYE': { city: 'Guayaquil',      countryCode: 'EC' },
  'MVD': { city: 'Montevideo',     countryCode: 'UY' },
  'ASU': { city: 'Asuncion',       countryCode: 'PY' },
  'PUJ': { city: 'Punta Cana',     countryCode: 'DO' },
  'SDQ': { city: 'Santo Domingo', countryCode: 'DO' },
  'MBJ': { city: 'Montego Bay',   countryCode: 'JM' },
  'NAS': { city: 'Nassau',        countryCode: 'BS' },
  'CMN': { city: 'Casablanca',    countryCode: 'MA' },
  'RAK': { city: 'Marrakech',     countryCode: 'MA' },
  'CAI': { city: 'Cairo',         countryCode: 'EG' },
  'CPT': { city: 'Cape Town',     countryCode: 'ZA' },
  'JNB': { city: 'Johannesburg',  countryCode: 'ZA' },
  'NBO': { city: 'Nairobi',       countryCode: 'KE' },
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
  rateId?:       string;
  name?:         string;
  boardType?:    string;
  boardName?:    string;
  maxOccupancy?: number;
  retailRate?: {
    total?: Array<{ amount: number; currency: string }>;
  };
  cancellationPolicies?: {
    refundableTag?:     string; // "RFN" = refundable, "NRFN" = non-refundable
    cancelPolicyInfos?: Array<{ cancelTime?: string; amount?: number; currency?: string; type?: string }>;
  };
  paymentTypes?: string[];
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

    // ── Cache check ────────────────────────────────────────────────────────────
    const cacheKey = `${city}::${countryCode}::${params.checkIn}::${params.checkOut}::${params.adults ?? 2}`;
    const cached = HOTEL_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < HOTEL_CACHE_TTL_MS) {
      console.log('[LiteAPI] hotel cache hit for', cacheKey);
      return cached.data;
    }

    // ── Step 1: Fetch hotel list for the city ──────────────────────────────────
    const listUrl =
      `${LITEAPI_BASE}/data/hotels?countryCode=${countryCode}` +
      `&cityName=${encodeURIComponent(city)}&limit=20`;

    const listRes = await fetch(listUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(8_000),   // was 15 s
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
        checkin:           params.checkIn,
        checkout:          params.checkOut,
        occupancies:       [{ adults: params.adults ?? 2, children: [] }],
        currency:          'USD',
        guestNationality:  countryCode === 'CA' ? 'CA' : 'US',
      }),
      signal: AbortSignal.timeout(20_000),   // was 35 s
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

      // Pick the cheapest available rate across all room types.
      // Track the parent room type's offerId alongside the rate's rateId —
      // LiteAPI v3 /rates/prebook requires the offerId (room-type level), not rateId.
      let cheapestRate: LiteRate | null = null;
      let cheapestOfferId: string | undefined;

      for (const rt of rateHotel.roomTypes ?? []) {
        for (const rate of rt.rates ?? []) {
          const amt     = rate.retailRate?.total?.[0]?.amount ?? 0;
          const bestAmt = cheapestRate?.retailRate?.total?.[0]?.amount ?? Infinity;
          if (amt > 0 && amt < bestAmt) {
            cheapestRate    = rate;
            cheapestOfferId = rt.offerId;   // room-type level ID for prebook
          }
        }
      }

      if (!cheapestRate) continue;

      const totalPrice = cheapestRate.retailRate?.total?.[0]?.amount ?? 0;
      if (totalPrice <= 0) continue;

      const pricePerNight = totalPrice / nights;

      // Apply user filters
      if (params.maxPrice && pricePerNight > params.maxPrice) continue;
      const stars = info.starRating ?? 3;
      if (params.stars && stars < params.stars) continue;

      // LiteAPI v3.0 tags: "RFN" = refundable, "NRFN" = non-refundable
      const refundableTag = cheapestRate.cancellationPolicies?.refundableTag ?? '';
      const refundable = refundableTag === 'RFN' || refundableTag === 'FULLY_REFUNDABLE';

      // bookingToken stores the offerId (preferred for prebook) with rateId as fallback.
      // Prefixed with 'liteapi_' so book-trip route can identify the provider.
      const rawToken    = cheapestOfferId ?? cheapestRate.rateId ?? '';
      const bookingToken = rawToken ? `liteapi_${rawToken}` : '';

      normalized.push({
        id:            rateHotel.hotelId,
        provider:      'liteapi',
        name:          info.name,
        location:      city,
        city:          city,
        stars,
        pricePerNight: Math.round(pricePerNight * 100) / 100,
        totalPrice:    Math.round(totalPrice * 100) / 100,
        currency:      cheapestRate.retailRate?.total?.[0]?.currency ?? 'USD',
        image:         info.main_photo ?? info.thumbnail ?? '',
        images:        info.main_photo ? [info.main_photo] : [],
        rating:        7.5 + (stars - 3) * 0.4, // Approximate: 5-star ≈ 8.3, 3-star ≈ 7.5
        amenities:     ['WiFi', 'Air Conditioning', ...(stars >= 4 ? ['Pool', 'Gym'] : [])],
        cancellation:  refundable ? 'Free cancellation' : 'Non-refundable',
        checkIn:       params.checkIn,
        checkOut:      params.checkOut,
        bookingToken,
        isSample:      false,
      });
    }

    const results = normalized
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 6);

    // Write to cache (even empty, prevents hammering the API on retries)
    HOTEL_CACHE.set(cacheKey, { data: results, ts: Date.now() });
    if (HOTEL_CACHE.size > 100) {
      const oldest = [...HOTEL_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      HOTEL_CACHE.delete(oldest[0]);
    }

    return results;
  }
}

// ─── Fresh rate fetch at booking time ─────────────────────────────────────────
// The search cache stores offerId tokens that can expire within minutes.
// Call this right before prebook to always pass a live token to LiteAPI.
export async function liteApiGetFreshOfferId(
  hotelId:         string,
  checkIn:         string,
  checkOut:        string,
  adults:          number,
  guestNationality = 'CA',
  apiKey?:         string,
): Promise<string | null> {
  const key = apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE')) return null;

  const headers: HeadersInit = {
    'X-API-Key':    key,
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };

  try {
    const res = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        hotelIds:        [hotelId],
        checkin:         checkIn,
        checkout:        checkOut,
        occupancies:     [{ adults: Math.max(1, adults), children: [] }],
        currency:        'USD',
        guestNationality,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('[liteApiGetFreshOfferId] rates fetch failed', res.status, txt.slice(0, 200));
      return null;
    }

    const data = await res.json() as { data?: LiteRateHotel[] };
    const hotel = data.data?.[0];
    if (!hotel) { console.warn('[liteApiGetFreshOfferId] no rate returned for', hotelId); return null; }

    // Pick cheapest room type — same logic as the search
    let bestOfferId: string | undefined;
    let bestRateId:  string | undefined;
    let bestPrice   = Infinity;

    for (const rt of hotel.roomTypes ?? []) {
      for (const rate of rt.rates ?? []) {
        const amt = rate.retailRate?.total?.[0]?.amount ?? 0;
        if (amt > 0 && amt < bestPrice) {
          bestPrice   = amt;
          bestOfferId = rt.offerId;
          bestRateId  = rate.rateId;
        }
      }
    }

    const freshId = bestOfferId ?? bestRateId ?? null;
    console.log('[liteApiGetFreshOfferId] fresh offerId for', hotelId, '→', freshId);
    return freshId;
  } catch (e) {
    console.error('[liteApiGetFreshOfferId] exception:', e);
    return null;
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
  offerId: string,   // This is the bookingToken = roomType.offerId (or rateId as fallback)
  guestNationality = 'US',
  apiKey?: string
): Promise<LiteApiPrebookResult> {
  const key = apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) {
    return { success: false, error: 'LITEAPI_KEY not configured — hotel booking unavailable' };
  }

  // LiteAPI v3 /rates/prebook expects the field `offerID` (capital ID) per their
  // Go validation tag: `Key: 'PreBookRequest.OfferID'`
  console.log('[liteApiPrebook] offerID:', offerId, 'guestNationality:', guestNationality);

  const res = await fetch(`${LITEAPI_BASE}/rates/prebook`, {
    method: 'POST',
    headers: {
      'X-API-Key':    key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({ offerID: offerId, guestNationality }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('[liteApiPrebook] failed', res.status, txt.slice(0, 400));

    // LiteAPI error 4002 = offerId expired / invalid — the rate token has a
    // short TTL. Surface a clear "go search again" message so the UI can
    // show an actionable prompt rather than a generic error.
    let errorCode = 0;
    try { errorCode = (JSON.parse(txt) as { error?: { code?: number } })?.error?.code ?? 0; } catch { /* ignore */ }
    if (errorCode === 4002 || errorCode === 4000) {
      return {
        success: false,
        error: 'HOTEL_RATE_EXPIRED: Hotel rates have expired — prices refresh every few minutes. Please go back to chat and search for hotels again.',
      };
    }

    return { success: false, error: `Prebook failed ${res.status}: ${txt.slice(0, 200)}` };
  }

  const raw = await res.json() as Record<string, unknown>;
  console.log('[liteApiPrebook] success, raw keys:', Object.keys(raw), 'data keys:', raw.data ? Object.keys(raw.data as object) : 'none');

  const data = raw as {
    data?: {
      prebookId?:  string;
      hotelId?:    string;
      currency?:   string;
      price?:      { total?: number; currency?: string };
      cancellationPolicies?: { type?: string; deadline?: string };
    };
  };

  const prebookId = data.data?.prebookId;
  if (!prebookId) {
    console.warn('[liteApiPrebook] no prebookId in response:', JSON.stringify(raw).slice(0, 300));
  }

  return {
    success:             true,
    prebookId,
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

  const isSandbox = key.startsWith('sand_');

  // LiteAPI v3 payment object field names (confirmed from their docs):
  //   method:     'ACC_CREDIT_CARD'  — NOT 'CREDIT_CARD'
  //   cardNumber: '4242...'          — NOT 'number'
  //   expireDate: 'MM/YYYY'          — 4-digit year
  // Sandbox test card: 4242424242424242, any 3-digit CVV, any future date.
  const payment = {
    method:     'ACC_CREDIT_CARD',
    holderName: `${params.guestFirstName} ${params.guestLastName}`,
    cardNumber: isSandbox ? '4242424242424242' : '',  // replaced by real token at prod
    expireDate: '12/2028',
    cvc:        '123',
  };

  // LiteAPI v3 book body: uses `holder` (not `guestInfo`) + a `guests` array
  const bookBody = {
    prebookId: params.prebookId,
    holder: {
      firstName: params.guestFirstName,
      lastName:  params.guestLastName,
      email:     params.guestEmail,
    },
    guests: [{
      occupancyNumber: 1,              // required by LiteAPI v3 — 1-based occupancy index
      firstName:       params.guestFirstName,
      lastName:        params.guestLastName,
      email:           params.guestEmail,
    }],
    payment,
  };

  console.log('[liteApiBook] prebookId:', params.prebookId, 'isSandbox:', isSandbox, 'method:', payment.method);

  const res = await fetch(`${LITEAPI_BASE}/rates/book`, {
    method: 'POST',
    headers: {
      'X-API-Key':    key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify(bookBody),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('[liteApiBook] failed', res.status, txt.slice(0, 400));
    return { success: false, error: `Booking failed ${res.status}: ${txt.slice(0, 300)}` };
  }

  const raw = await res.json() as Record<string, unknown>;
  console.log('[liteApiBook] success! top-level keys:', Object.keys(raw), '| data keys:', raw.data ? Object.keys(raw.data as object) : 'none');

  const data = raw as {
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
