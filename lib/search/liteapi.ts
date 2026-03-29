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

// ─── Multi-room occupancy builder ─────────────────────────────────────────────
// Most hotels enforce a maximum of 2 adults per room. This helper distributes
// N adults across the minimum number of rooms (ceil(N/2)), returning a valid
// LiteAPI occupancies array. Examples:
//   1 adult  → [{ adults: 1 }]
//   2 adults → [{ adults: 2 }]
//   3 adults → [{ adults: 2 }, { adults: 1 }]
//   4 adults → [{ adults: 2 }, { adults: 2 }]
//   5 adults → [{ adults: 2 }, { adults: 2 }, { adults: 1 }]
// The price LiteAPI returns covers ALL rooms combined.
function buildOccupancies(adults: number): Array<{ adults: number; children: never[] }> {
  const n     = Math.max(1, adults);
  const rooms = Math.ceil(n / 2);
  return Array.from({ length: rooms }, (_, i) => {
    const isLast     = i === rooms - 1;
    const roomAdults = isLast && n % 2 === 1 ? 1 : 2;
    return { adults: roomAdults, children: [] as never[] };
  });
}

// ─── Hotel search cache (in-process, 30-min TTL per city+dates+guests) ─────────
// Avoids hitting LiteAPI's slow rates endpoint on every message turn.
const HOTEL_CACHE = new Map<string, { data: NormalizedHotel[]; ts: number }>();
const HOTEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Hotel detail cache (60-min TTL, keyed by hotelId) ────────────────────────
// /data/hotel returns static info: description, images, facilities, check-in times.
// Separate from rates cache — this data rarely changes.
const HOTEL_DETAIL_CACHE = new Map<string, { data: LiteHotelDetail; ts: number }>();
const HOTEL_DETAIL_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

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
  'DPS': { city: 'Kuta',          countryCode: 'ID' },  // Bali island → Kuta (near airport, best LiteAPI coverage)
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

// When a city name returns 0 hotels from LiteAPI /data/hotels, try these alternatives
// in order. LiteAPI indexes by specific municipality names, not regions/islands.
const CITY_FALLBACKS: Record<string, string[]> = {
  'bali':      ['Seminyak', 'Denpasar', 'Ubud', 'Nusa Dua'],
  'kuta':      ['Seminyak', 'Denpasar', 'Ubud', 'Nusa Dua'],
  'maldives':  ['Male', 'Hulhule'],
  'phuket':    ['Patong', 'Kathu', 'Bang Tao'],
  'santorini': ['Fira', 'Oia', 'Thira'],
  'mykonos':   ['Mykonos Town', 'Mykonos'],
  'ibiza':     ['Ibiza Town', 'Sant Antoni'],
  'bora bora': ['Vaitape', 'Bora-Bora'],
};

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
  country?:    string;
  address?:    string;
  city?:       string;
  location?:   { latitute?: number; longitude?: number; address?: string; city?: string; countryCode?: string };
}

// Full hotel detail from GET /data/hotel?hotelId=xxx
// Includes rich description, all images, real facility list, check-in times
interface LiteHotelDetail {
  id:           string;
  name:         string;
  starRating?:  number;
  main_photo?:  string;
  hotelDescription?: string;   // HTML description
  checkinCheckoutTimes?: {
    checkin?:      string;     // e.g. "02:00 PM"
    checkout?:     string;     // e.g. "11:30 AM"
    checkinStart?: string;
    checkinEnd?:   string;
  };
  hotelImages?: Array<{
    url:           string;
    caption?:      string;
    order?:        number;
    defaultImage?: boolean;
  }>;
  hotelFacilities?: string[];  // real amenities / facilities
  location?: {
    latitute?:    number;
    longitude?:   number;
    address?:     string;
    city?:        string;
    countryCode?: string;
    zipCode?:     string;
  };
  contacts?: {
    telephone?: string;
    fax?:       string;
    email?:     string;
    website?:   string;
  };
}

interface LiteRate {
  rateId?:          string;
  name?:            string;
  boardType?:       string;    // "RO" | "BB" | "HB" | "FB" | "AI"
  boardName?:       string;    // "Room Only" | "Bed & Breakfast" etc.
  maxOccupancy?:    number;
  adultCount?:      number;
  childCount?:      number;
  occupancyNumber?: number;
  priceType?:       string;    // "commission"
  remarks?:         string;    // HTML with amenities, policies, special instructions
  commission?:      Array<{ amount: number; currency: string }>;
  retailRate?: {
    total?:         Array<{ amount: number; currency: string }>;
    msp?:           Array<{ amount: number; currency: string }>;
    taxesAndFees?:  Array<{ included: boolean; description: string; amount: number; currency: string }>;
  };
  cancellationPolicies?: {
    refundableTag?:     string;  // "RFN" = refundable, "NRFN" = non-refundable
    cancelPolicyInfos?: Array<{ cancelTime?: string; amount?: number; currency?: string; type?: string; timezone?: string }>;
    hotelRemarks?:      string[];
  };
  paymentTypes?: string[];
}

interface LiteRoomType {
  offerId?:      string;
  name?:         string;
  maxOccupancy?: number;
  rates?:        LiteRate[];
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
    // limit=12 keeps the rates payload small → faster rates call.
    // Some destinations are indexed by specific municipality names in LiteAPI
    // (e.g. "Kuta" not "Bali"). Try the primary city, then CITY_FALLBACKS if 0 results.
    const fetchHotelList = async (cityName: string): Promise<LiteHotelListItem[]> => {
      const url =
        `${LITEAPI_BASE}/data/hotels?countryCode=${countryCode}` +
        `&cityName=${encodeURIComponent(cityName)}&limit=12`;
      const res = await fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`LiteAPI hotels list ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json() as { data?: LiteHotelListItem[] };
      return data.data ?? [];
    };

    let hotelList = await fetchHotelList(city);
    let resolvedCity = city;

    if (hotelList.length === 0) {
      const alternatives = CITY_FALLBACKS[city.toLowerCase()] ?? [];
      for (const alt of alternatives) {
        console.log(`[LiteAPI] 0 hotels for "${city}" — trying fallback city: "${alt}"`);
        hotelList = await fetchHotelList(alt);
        if (hotelList.length > 0) {
          resolvedCity = alt;
          console.log(`[LiteAPI] Found ${hotelList.length} hotels with fallback city: "${alt}"`);
          break;
        }
      }
    }

    if (hotelList.length === 0) {
      throw new Error(`No hotels found for ${city}, ${countryCode} in LiteAPI (tried all fallbacks)`);
    }

    console.log(`[LiteAPI] Using city "${resolvedCity}" — ${hotelList.length} hotels found`);

    // Build a lookup map for hotel details by ID
    const hotelInfoMap = new Map(hotelList.map(h => [h.id, h]));
    const hotelIds = hotelList.map(h => h.id);

    // ── Step 2: Fetch live rates ────────────────────────────────────────────────
    const ratesRes = await fetch(`${LITEAPI_BASE}/hotels/rates`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        hotelIds,
        checkin:          params.checkIn,
        checkout:         params.checkOut,
        occupancies:      buildOccupancies(params.adults ?? 2),
        currency:         'USD',
        guestNationality: countryCode === 'CA' ? 'CA' : 'US',
        roomMapping:      true,   // ensures offerId is included in each roomType object
        timeout:          3,      // server-side timeout seconds per LiteAPI spec (3 s keeps total wall-clock under 12 s)
      }),
      signal: AbortSignal.timeout(20_000),
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

      // Filtering is handled by the aggregator — provider returns all results
      const stars = info.starRating ?? 3;

      // LiteAPI v3.0 tags: "RFN" = refundable, "NRFN" = non-refundable
      const refundableTag = cheapestRate.cancellationPolicies?.refundableTag ?? '';
      const refundable = refundableTag === 'RFN' || refundableTag === 'FULLY_REFUNDABLE';

      // bookingToken stores the offerId (preferred for prebook) with rateId as fallback.
      // Prefixed with 'liteapi_' so book-trip route can identify the provider.
      const rawToken    = cheapestOfferId ?? cheapestRate.rateId ?? '';
      const bookingToken = rawToken ? `liteapi_${rawToken}` : '';

      // Build all room types for UX (room selection, comparison)
      const allRoomTypes = (rateHotel.roomTypes ?? []).map(rt => ({
        offerId:      rt.offerId,
        name:         rt.name,
        maxOccupancy: rt.maxOccupancy,
        rates: (rt.rates ?? []).map(r => ({
          rateId:    r.rateId,
          name:      r.name,
          boardType: r.boardType,
          boardName: r.boardName,
          price:     r.retailRate?.total?.[0]?.amount,
          currency:  r.retailRate?.total?.[0]?.currency,
          commission: r.commission?.[0]?.amount,
          refundable: r.cancellationPolicies?.refundableTag === 'RFN',
        })),
      }));

      normalized.push({
        id:            rateHotel.hotelId,
        provider:      'liteapi',
        name:          info.name,
        location:      resolvedCity,
        city:          resolvedCity,
        stars,
        pricePerNight: Math.round(pricePerNight * 100) / 100,
        totalPrice:    Math.round(totalPrice * 100) / 100,
        currency:      cheapestRate.retailRate?.total?.[0]?.currency ?? 'USD',
        image:         info.main_photo ?? info.thumbnail ?? '',
        images:        info.main_photo ? [info.main_photo] : [],
        rating:        7.5 + (stars - 3) * 0.4,  // 5-star ≈ 8.3, 3-star ≈ 7.5
        amenities:     [],   // will be populated by liteApiGetHotelDetail (real API data)
        cancellation:  refundable ? 'Free cancellation' : 'Non-refundable',
        checkIn:       params.checkIn,
        checkOut:      params.checkOut,
        bookingToken,
        isSample:      false,
        // Board type from cheapest rate
        boardType:     cheapestRate.boardType,
        boardName:     cheapestRate.boardName,
        maxOccupancy:  cheapestRate.maxOccupancy,
        // Pricing breakdown
        mspPrice:      cheapestRate.retailRate?.msp?.[0]?.amount,
        commissionAmount:   cheapestRate.commission?.[0]?.amount,
        commissionCurrency: cheapestRate.commission?.[0]?.currency,
        taxesAndFees:  cheapestRate.retailRate?.taxesAndFees,
        // Cancellation detail
        cancelPolicies: cheapestRate.cancellationPolicies?.cancelPolicyInfos,
        refundableTag,
        // All room types for future UX
        allRoomTypes,
        // Number of rooms needed for this party size (ceil(adults/2))
        roomCount: Math.ceil((params.adults ?? 2) / 2),
        address: info.address ?? (info.location as { address?: string } | undefined)?.address,
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
        occupancies:     buildOccupancies(adults),
        currency:        'USD',
        guestNationality,
        roomMapping:     true,   // ensures offerId field is present on each roomType
        timeout:         5,
      }),
      signal: AbortSignal.timeout(20_000),
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

// ─── Hotel detail fetch (GET /data/hotel) ─────────────────────────────────────
// Returns rich hotel info: description, all images, real facilities, check-in times.
// Cached 60 min. Safe to call at any time — does NOT consume rate quota.
export async function liteApiGetHotelDetail(
  hotelId: string,
  apiKey?: string
): Promise<LiteHotelDetail | null> {
  const key = apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) return null;

  // Check cache first
  const cached = HOTEL_DETAIL_CACHE.get(hotelId);
  if (cached && Date.now() - cached.ts < HOTEL_DETAIL_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(
      `${LITEAPI_BASE}/data/hotel?hotelId=${encodeURIComponent(hotelId)}&timeout=5`,
      {
        headers: { 'X-API-Key': key, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) {
      console.warn('[liteApiGetHotelDetail] failed', res.status, 'for', hotelId);
      return null;
    }
    const raw = await res.json() as { data?: LiteHotelDetail };
    const detail = raw.data;
    if (!detail) return null;

    // Normalise images: sort by order, put defaultImage first
    if (detail.hotelImages?.length) {
      detail.hotelImages.sort((a, b) => {
        if (a.defaultImage && !b.defaultImage) return -1;
        if (!a.defaultImage && b.defaultImage) return 1;
        return (a.order ?? 99) - (b.order ?? 99);
      });
    }

    HOTEL_DETAIL_CACHE.set(hotelId, { data: detail, ts: Date.now() });
    return detail;
  } catch (e) {
    console.error('[liteApiGetHotelDetail] exception for', hotelId, ':', e);
    return null;
  }
}

// ─── Pre-booking helper (used by bookHotel tool in chat route) ─────────────────
export interface LiteApiPrebookResult {
  success:               boolean;
  prebookId?:            string;
  hotelId?:              string;
  confirmedTotal?:       number;
  currency?:             string;
  cancellationType?:     string;
  cancellationDeadline?: string;
  // Pricing intel returned by prebook (useful for final price display)
  msp?:                  number;   // merchant selling price confirmed at prebook
  commission?:           number;   // commission amount
  priceDifferencePercent?: number; // % change since rate search (0 = no change)
  // ── Payment SDK fields (production only, when usePaymentSdk: true) ──────────
  // LiteAPI returns secretKey + transactionId when usePaymentSdk=true.
  // These are passed to the frontend to initialize the LiteAPI payment widget.
  // Widget URL: https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js
  secretKey?:            string;
  transactionId?:        string;
  requiresPaymentSdk?:   boolean;  // true in production, false in sandbox
  error?:                string;
}

export async function liteApiPrebook(
  offerId: string,   // This is the bookingToken = roomType.offerId from /hotels/rates response
  _guestNationality?: string,  // kept for signature compat; NOT sent to LiteAPI (not in API spec)
  apiKey?: string
): Promise<LiteApiPrebookResult> {
  const key = apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) {
    return { success: false, error: 'LITEAPI_KEY not configured — hotel booking unavailable' };
  }

  // Sandbox keys start with "sand_"; production keys start with "prod_"
  // - Sandbox:    usePaymentSdk: false → LiteAPI accepts ACC_CREDIT_CARD server-side
  // - Production: usePaymentSdk: true  → LiteAPI returns secretKey + transactionId for
  //               the payment SDK widget (payment-wrapper.liteapi.travel/dist/liteAPIPayment.js)
  //               Customer enters card details in the LiteAPI-hosted widget; we never touch card data.
  const isSandbox    = key.startsWith('sand_');
  const usePaymentSdk = !isSandbox;

  console.log('[liteApiPrebook] offerId:', offerId.slice(0, 40) + (offerId.length > 40 ? '…' : ''), '| isSandbox:', isSandbox, '| usePaymentSdk:', usePaymentSdk);

  // Sandbox: omit usePaymentSdk entirely (LiteAPI defaults to server-side card).
  // Production: send usePaymentSdk: true so LiteAPI returns secretKey + transactionId.
  const prebookBody: Record<string, unknown> = { offerId };
  if (!isSandbox) prebookBody.usePaymentSdk = true;

  const res = await fetch(`${LITEAPI_BASE}/rates/prebook`, {
    method: 'POST',
    headers: {
      'X-API-Key':    key,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify(prebookBody),
    signal: AbortSignal.timeout(35_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('[liteApiPrebook] failed', res.status, txt.slice(0, 400));

    // LiteAPI error 4002 = offerId expired / invalid — the rate token has a
    // short TTL. Surface a clear "go search again" message.
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
      prebookId?:              string;
      hotelId?:                string;
      currency?:               string;
      price?:                  number;  // LiteAPI v3 returns price at top level in prebook
      msp?:                    number;
      commission?:             number;
      priceDifferencePercent?: number;
      cancellationPolicies?:   { type?: string; deadline?: string };
      // Payment SDK fields — only present when usePaymentSdk: true
      secretKey?:              string;
      transactionId?:          string;
    };
  };

  const prebookId = data.data?.prebookId;
  if (!prebookId) {
    console.warn('[liteApiPrebook] no prebookId in response:', JSON.stringify(raw).slice(0, 300));
  }

  const secretKey     = data.data?.secretKey;
  const transactionId = data.data?.transactionId;
  if (usePaymentSdk) {
    console.log('[liteApiPrebook] SDK keys — secretKey present:', !!secretKey, '| transactionId present:', !!transactionId);
  }

  return {
    success:               true,
    prebookId,
    hotelId:               data.data?.hotelId,
    confirmedTotal:        data.data?.price ?? data.data?.msp,
    currency:              data.data?.currency ?? 'USD',
    cancellationType:      data.data?.cancellationPolicies?.type,
    cancellationDeadline:  data.data?.cancellationPolicies?.deadline,
    msp:                   data.data?.msp,
    commission:            data.data?.commission,
    priceDifferencePercent: data.data?.priceDifferencePercent,
    // Payment SDK — populated in production, undefined in sandbox
    secretKey,
    transactionId,
    requiresPaymentSdk: usePaymentSdk && !!secretKey,
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
  // transactionId: provided by LiteAPI payment SDK after customer completes payment (production).
  // When present, method is TRANSACTION_ID. When absent (sandbox), method is ACC_CREDIT_CARD.
  transactionId?:     string;
  // Additional adult guests beyond the lead (for multi-passenger bookings)
  additionalGuests?:  { firstName: string; lastName: string; email?: string }[];
  apiKey?:            string;
}): Promise<LiteApiBookResult> {
  const key = params.apiKey ?? process.env.LITEAPI_KEY;
  if (!key || key.includes('PASTE') || key.includes('your_')) {
    return { success: false, error: 'LITEAPI_KEY not configured' };
  }

  const isSandbox = key.startsWith('sand_');

  // Payment method selection:
  //   Production + payment SDK: TRANSACTION_ID (customer paid via LiteAPI's hosted widget)
  //   Sandbox / fallback:       ACC_CREDIT_CARD (LiteAPI's built-in sandbox test card)
  // LiteAPI v3 payment object field names (confirmed from official Postman collection):
  //   method:     'ACC_CREDIT_CARD' or 'TRANSACTION_ID'
  //   cardNumber: '4242...'  (ACC_CREDIT_CARD only)
  //   expireDate: 'MM/YYYY'  (4-digit year)
  // LiteAPI v3 ACC_CREDIT_CARD payment object — holderName is NOT a valid field in
  // the v3 spec and causes a 400 validation error. Only cardNumber/expireDate/cvc.
  const payment = params.transactionId
    ? { method: 'TRANSACTION_ID', transactionId: params.transactionId }
    : {
        method:     'ACC_CREDIT_CARD',
        cardNumber: '4242424242424242',  // LiteAPI sandbox test card
        expireDate: '12/2028',
        cvc:        '123',
      };

  // LiteAPI v3 book body: uses `holder` (not `guestInfo`) + a `guests` array.
  // All adult passengers are included so LiteAPI has accurate occupancy info.
  //
  // occupancyNumber = which ROOM the guest is in (1-based), NOT their guest index.
  // We book ceil(N/2) rooms (2 adults max per room, matching buildOccupancies logic).
  //   Guest 0 → room 1, Guest 1 → room 1, Guest 2 → room 2, Guest 3 → room 2 …
  const allPassengers = [
    { firstName: params.guestFirstName, lastName: params.guestLastName, email: params.guestEmail },
    ...(params.additionalGuests ?? []),
  ];

  const guestEntries = allPassengers.map((g, i) => ({
    occupancyNumber: Math.floor(i / 2) + 1,   // 2 per room, 1-based room index
    firstName:       g.firstName,
    lastName:        g.lastName,
    ...(g.email ? { email: g.email } : {}),
  }));

  const bookBody = {
    prebookId: params.prebookId,
    holder: {
      firstName: params.guestFirstName,
      lastName:  params.guestLastName,
      email:     params.guestEmail,
    },
    guests: guestEntries,
    payment,
  };

  console.log('[liteApiBook] prebookId:', params.prebookId, 'isSandbox:', isSandbox, 'method:', (payment as { method: string }).method);

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
  // Log full raw response so we can see the exact shape LiteAPI returns
  console.log('[liteApiBook] full raw response:', JSON.stringify(raw).slice(0, 1000));

  const d = (raw.data ?? {}) as Record<string, unknown>;

  // LiteAPI v3 may use different keys across sandbox/production:
  // "bookingId", "id", "booking_id", "bookingReference" — check all
  const bookingId =
    (d.bookingId  as string | undefined) ??
    (d.id         as string | undefined) ??
    (d.booking_id as string | undefined) ??
    (d.bookingReference as string | undefined);

  if (!bookingId) {
    console.warn('[liteApiBook] WARNING: booking succeeded (2xx) but no bookingId found in response. Full data keys:', Object.keys(d));
  } else {
    console.log('[liteApiBook] bookingId:', bookingId);
  }

  const priceObj = d.price as { total?: number; currency?: string } | undefined;
  const hotelObj = d.hotel as { name?: string; address?: string } | undefined;

  return {
    success:     true,
    bookingId,
    status:      d.status as string | undefined,
    totalAmount: priceObj?.total,
    currency:    priceObj?.currency ?? 'USD',
    hotelName:   hotelObj?.name,
    address:     hotelObj?.address,
    checkIn:     d.checkIn as string | undefined,
    checkOut:    d.checkOut as string | undefined,
  };
}
