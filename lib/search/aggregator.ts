// ─── Multi-Source Search Aggregator ──────────────────────────────────────────
// Fires all configured providers in parallel, merges results, deduplicates,
// and returns the best options ranked by price.

import type {
  SearchProvider, FlightSearchParams, HotelSearchParams,
  NormalizedFlight, NormalizedHotel, SearchResult,
  ExperienceSearchParams, NormalizedExperience,
} from './types';
import { DuffelProvider } from './duffel';
import { AmadeusProvider } from './amadeus';
import { LiteApiProvider } from './liteapi';
import { OpenTripMapProvider } from './opentripmap';
import { FoursquareProvider } from './foursquare';

// ─── North America airport geography (for context + validation) ───────────────
// Major NA hubs used for suggestion if user provides city name
export const NA_AIRPORTS: Record<string, string> = {
  // Canada
  'toronto': 'YYZ', 'vancouver': 'YVR', 'montreal': 'YUL', 'calgary': 'YYC',
  'ottawa': 'YOW', 'winnipeg': 'YWG', 'edmonton': 'YEG', 'halifax': 'YHZ',
  'victoria': 'YYJ', 'kelowna': 'YLW',
  // USA
  'new york': 'JFK', 'nyc': 'JFK', 'los angeles': 'LAX', 'la': 'LAX',
  'chicago': 'ORD', 'dallas': 'DFW', 'miami': 'MIA', 'san francisco': 'SFO',
  'seattle': 'SEA', 'denver': 'DEN', 'boston': 'BOS', 'atlanta': 'ATL',
  'houston': 'IAH', 'phoenix': 'PHX', 'las vegas': 'LAS', 'orlando': 'MCO',
  'portland': 'PDX', 'minneapolis': 'MSP', 'detroit': 'DTW', 'washington': 'IAD',
};

// ─── Build providers from env vars ────────────────────────────────────────────
function buildProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];

  const duffelToken = process.env.DUFFEL_ACCESS_TOKEN;
  if (duffelToken && !duffelToken.includes('PASTE')) {
    providers.push(new DuffelProvider(duffelToken));
  }

  // Support both naming conventions (AMADEUS_CLIENT_ID or AMADEUS_API_KEY)
  const amadeusId =
    process.env.AMADEUS_CLIENT_ID?.replace(/PASTE.*/i, '') ||
    process.env.AMADEUS_API_KEY || '';
  const amadeusSecret =
    process.env.AMADEUS_CLIENT_SECRET?.replace(/PASTE.*/i, '') ||
    process.env.AMADEUS_API_SECRET || '';
  if (amadeusId && amadeusSecret) {
    providers.push(new AmadeusProvider(amadeusId, amadeusSecret));
  }

  // LiteAPI — real-time hotel rates (hotels-only provider)
  const liteApiKey = process.env.LITEAPI_KEY;
  if (liteApiKey && !liteApiKey.includes('PASTE') && !liteApiKey.includes('your_')) {
    providers.push(new LiteApiProvider(liteApiKey));
  }

  return providers;
}

// ─── Deduplication helpers ────────────────────────────────────────────────────

/** Deduplicate flights by (airline + flightNumber + departure time) */
function dedupeFlights(flights: NormalizedFlight[]): NormalizedFlight[] {
  const seen = new Set<string>();
  return flights.filter(f => {
    const key = [
      f.segments.map(s => s.flightNumber).join('|'),
      f.departure.slice(0, 16),
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deduplicate hotels by name (case-insensitive, trimmed) */
function dedupeHotels(hotels: NormalizedHotel[]): NormalizedHotel[] {
  const seen = new Set<string>();
  return hotels.filter(h => {
    const key = h.name.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Curated fallback hotel images (images.unsplash.com CDN — no API key needed) ─
const HOTEL_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop', // luxury pool aerial
  'https://images.unsplash.com/photo-1551882547-ff40c4a49a68?w=600&h=400&fit=crop', // boutique hotel night
  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&h=400&fit=crop', // resort poolside
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600&h=400&fit=crop', // infinity pool
  'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop', // hotel lobby
];

// ─── Sample hotel fallback ────────────────────────────────────────────────────
function sampleHotels(params: HotelSearchParams): NormalizedHotel[] {
  const nights = Math.max(
    1,
    Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86400000)
  );
  const dest = params.destination;
  return [
    {
      id: 'sample_luxury', provider: 'sample',
      name: `${dest} Grand Hotel & Spa`,
      location: dest, city: dest, stars: 5,
      pricePerNight: 320, totalPrice: 320 * nights, currency: 'USD',
      image: HOTEL_FALLBACK_IMAGES[0],
      images: HOTEL_FALLBACK_IMAGES,
      rating: 9.2, reviewCount: 380,
      amenities: ['Free WiFi', 'Infinity Pool', 'Spa', 'Breakfast', 'Gym'],
      cancellation: 'Free cancellation', checkIn: params.checkIn, checkOut: params.checkOut,
      isSample: true,
    },
    {
      id: 'sample_boutique', provider: 'sample',
      name: `${dest} Boutique Suites`,
      location: dest, city: dest, stars: 4,
      pricePerNight: 185, totalPrice: 185 * nights, currency: 'USD',
      image: HOTEL_FALLBACK_IMAGES[1],
      images: HOTEL_FALLBACK_IMAGES,
      rating: 8.7, reviewCount: 220,
      amenities: ['Free WiFi', 'Rooftop Bar', 'Concierge'],
      cancellation: 'Free cancellation', checkIn: params.checkIn, checkOut: params.checkOut,
      isSample: true,
    },
    {
      id: 'sample_budget', provider: 'sample',
      name: `${dest} Comfort Inn`,
      location: dest, city: dest, stars: 3,
      pricePerNight: 95, totalPrice: 95 * nights, currency: 'USD',
      image: HOTEL_FALLBACK_IMAGES[2],
      images: HOTEL_FALLBACK_IMAGES,
      rating: 7.5, reviewCount: 640,
      amenities: ['Free WiFi', 'Breakfast', '24hr Reception'],
      cancellation: 'Non-refundable (cheapest rate)', checkIn: params.checkIn, checkOut: params.checkOut,
      isSample: true,
    },
  ];
}

// ─── Main aggregation functions ────────────────────────────────────────────────

export async function aggregateFlights(params: FlightSearchParams): Promise<{
  flights: NormalizedFlight[];
  sources: string[];
  errors: string[];
  latencyMs: number;
}> {
  const providers = buildProviders();
  const start = Date.now();

  if (providers.length === 0) {
    return { flights: [], sources: [], errors: ['No flight providers configured'], latencyMs: 0 };
  }

  // Run all providers in parallel
  const results = await Promise.allSettled(
    providers.map(async (p): Promise<SearchResult<NormalizedFlight>> => {
      const t0 = Date.now();
      try {
        const results = await p.searchFlights(params);
        return { provider: p.name, results, latencyMs: Date.now() - t0 };
      } catch (err) {
        return { provider: p.name, results: [], latencyMs: Date.now() - t0, error: String(err) };
      }
    })
  );

  const allFlights: NormalizedFlight[] = [];
  const sources: string[] = [];
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allFlights.push(...r.value.results);
      if (r.value.results.length > 0) sources.push(r.value.provider);
      if (r.value.error) errors.push(`${r.value.provider}: ${r.value.error}`);
    } else {
      errors.push(String(r.reason));
    }
  }

  const deduped = dedupeFlights(allFlights).sort((a, b) => a.price - b.price).slice(0, 8);

  return {
    flights: deduped,
    sources,
    errors,
    latencyMs: Date.now() - start,
  };
}

export async function aggregateHotels(params: HotelSearchParams): Promise<{
  hotels: NormalizedHotel[];
  sources: string[];
  errors: string[];
  isSample: boolean;
  latencyMs: number;
}> {
  const providers = buildProviders().filter(p => p.name !== 'duffel'); // Duffel is flights-only
  const start = Date.now();

  if (providers.length === 0) {
    // Return sample data — will be flagged so AI can disclose this to user
    return {
      hotels: sampleHotels(params),
      sources: ['sample'],
      errors: [],
      isSample: true,
      latencyMs: Date.now() - start,
    };
  }

  const results = await Promise.allSettled(
    providers.map(async (p): Promise<SearchResult<NormalizedHotel>> => {
      const t0 = Date.now();
      try {
        const results = await p.searchHotels(params);
        return { provider: p.name, results, latencyMs: Date.now() - t0 };
      } catch (err) {
        return { provider: p.name, results: [], latencyMs: Date.now() - t0, error: String(err) };
      }
    })
  );

  const allHotels: NormalizedHotel[] = [];
  const sources: string[] = [];
  const errors: string[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allHotels.push(...r.value.results);
      if (r.value.results.length > 0) sources.push(r.value.provider);
      if (r.value.error) errors.push(`${r.value.provider}: ${r.value.error}`);
    } else {
      errors.push(String(r.reason));
    }
  }

  const filtered = dedupeHotels(allHotels)
    .filter(h => !params.maxPrice || h.pricePerNight <= params.maxPrice)
    .filter(h => !params.stars || h.stars >= params.stars)
    .sort((a, b) => a.pricePerNight - b.pricePerNight)
    .slice(0, 6);

  // If real search returned nothing, fall back to samples
  if (filtered.length === 0) {
    return {
      hotels: sampleHotels(params),
      sources: ['sample'],
      errors,
      isSample: true,
      latencyMs: Date.now() - start,
    };
  }

  return { hotels: filtered, sources, errors, isSample: false, latencyMs: Date.now() - start };
}

// ─── Experience aggregation ────────────────────────────────────────────────────
// Provider priority: Foursquare (primary) → OpenTripMap (fallback)
export async function aggregateExperiences(params: ExperienceSearchParams): Promise<{
  experiences: NormalizedExperience[];
  sources: string[];
  errors: string[];
}> {
  const fsqKey = process.env.FOURSQUARE_API_KEY;
  const otmKey = process.env.OPENTRIPMAP_KEY;

  // Try Foursquare first (richer data, photos, ratings)
  if (fsqKey && !fsqKey.includes('PASTE') && !fsqKey.includes('your_')) {
    try {
      const provider = new FoursquareProvider(fsqKey);
      const experiences = await provider.searchExperiences(params);
      if (experiences.length > 0) {
        return { experiences, sources: ['foursquare'], errors: [] };
      }
    } catch (err) {
      // Fall through to OpenTripMap
      console.warn('[aggregateExperiences] Foursquare failed, trying OpenTripMap:', String(err));
    }
  }

  // Fallback to OpenTripMap
  if (otmKey && !otmKey.includes('PASTE') && !otmKey.includes('your_')) {
    try {
      const provider = new OpenTripMapProvider(otmKey);
      const experiences = await provider.searchExperiences(params);
      return { experiences, sources: ['opentripmap'], errors: [] };
    } catch (err) {
      return { experiences: [], sources: [], errors: [`OpenTripMap: ${String(err)}`] };
    }
  }

  return { experiences: [], sources: [], errors: ['No experience provider configured (add FOURSQUARE_API_KEY to .env.local)'] };
}
