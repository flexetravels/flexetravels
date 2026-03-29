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

  // Amadeus disabled — using Duffel exclusively for flights, LiteAPI for hotels

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
export function sampleHotels(params: HotelSearchParams): NormalizedHotel[] {
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
  // liteapi is a hotel-only provider — exclude from flight search
  const providers = buildProviders().filter(p => p.name !== 'liteapi');
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

export interface HotelAggregateResult {
  hotels: NormalizedHotel[];
  sources: string[];
  errors: string[];
  isSample: boolean;
  latencyMs: number;
  /** Set when hotels is empty — tells the AI exactly what to say to the user */
  noResultsMessage?: string;
}

export async function aggregateHotels(params: HotelSearchParams): Promise<HotelAggregateResult> {
  // LiteAPI is the hotel provider. Amadeus returns unreliable hotel data (400s) —
  // exclude it from hotel searches so errors don't pollute the result log.
  const providers = buildProviders().filter(p => p.name !== 'duffel' && p.name !== 'amadeus');
  const start = Date.now();

  if (providers.length === 0) {
    // LiteAPI key not configured — honest empty response, no fabrication
    return {
      hotels: [],
      sources: [],
      errors: ['Hotel provider not configured (LITEAPI_KEY missing)'],
      isSample: false,
      latencyMs: Date.now() - start,
      noResultsMessage: 'Hotel search is not available right now — please try again shortly.',
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

  const deduped = dedupeHotels(allHotels);

  const filtered = deduped
    .filter(h => !params.maxPrice || h.pricePerNight <= params.maxPrice)
    .filter(h => !params.stars || h.stars >= params.stars)
    .sort((a, b) => a.pricePerNight - b.pricePerNight)
    .slice(0, 6);

  console.log(`[aggregateHotels] raw=${allHotels.length}, deduped=${deduped.length}, filtered=${filtered.length}, maxPrice=${params.maxPrice ?? 'none'}, stars=${params.stars ?? 'none'}`);

  // Filters eliminated everything but raw results exist — relax filters
  if (filtered.length === 0 && deduped.length > 0) {
    const relaxed = deduped
      .sort((a, b) => a.pricePerNight - b.pricePerNight)
      .slice(0, 6);
    return {
      hotels: relaxed, sources, errors, isSample: false,
      latencyMs: Date.now() - start,
      noResultsMessage: `No hotels matched your exact budget/star filters, but here are the best available options:`,
    };
  }

  // No real results at all — use sample hotels as last resort
  if (filtered.length === 0) {
    const samples = sampleHotels(params);
    return {
      hotels: samples,
      sources: ['sample'],
      errors,
      isSample: true,
      latencyMs: Date.now() - start,
      noResultsMessage: `No live hotel inventory found for ${params.destination} on these dates. Here are indicative options to give you an idea of pricing:`,
    };
  }

  return { hotels: filtered, sources, errors, isSample: false, latencyMs: Date.now() - start };
}

// ─── Experience aggregation ────────────────────────────────────────────────────
// Architecture: Foursquare + OpenTripMap race in PARALLEL, hard 8 s wall-clock cap.
// Results are cached in-process (LRU-style Map, 1 h TTL) so repeat searches
// on the same destination return instantly and never block the chat stream.

const EXPERIENCE_CACHE = new Map<string, { data: NormalizedExperience[]; sources: string[]; ts: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function expCacheKey(params: ExperienceSearchParams): string {
  return `${params.destination?.toLowerCase()}::${params.category ?? 'all'}`;
}

export async function aggregateExperiences(params: ExperienceSearchParams): Promise<{
  experiences: NormalizedExperience[];
  sources: string[];
  errors: string[];
}> {
  // ── Cache hit ──────────────────────────────────────────────────────────────
  const cacheKey = expCacheKey(params);
  const cached = EXPERIENCE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { experiences: cached.data, sources: cached.sources, errors: [] };
  }

  const fsqKey = process.env.FOURSQUARE_API_KEY;
  const otmKey = process.env.OPENTRIPMAP_KEY;

  // Build provider promises (only for configured providers)
  type ProviderResult = { experiences: NormalizedExperience[]; source: string };
  const candidates: Promise<ProviderResult>[] = [];

  if (fsqKey && !fsqKey.includes('PASTE') && !fsqKey.includes('your_')) {
    candidates.push(
      new FoursquareProvider(fsqKey)
        .searchExperiences(params)
        .then(experiences => ({ experiences, source: 'foursquare' }))
    );
  }

  if (otmKey && !otmKey.includes('PASTE') && !otmKey.includes('your_')) {
    candidates.push(
      new OpenTripMapProvider(otmKey)
        .searchExperiences(params)
        .then(experiences => ({ experiences, source: 'opentripmap' }))
    );
  }

  if (candidates.length === 0) {
    return { experiences: [], sources: [], errors: ['No experience provider configured'] };
  }

  // ── Hard 8 s wall-clock cap: race all providers + timeout sentinel ──────────
  const WALL_CLOCK_MS = 8_000;
  const timeout = new Promise<ProviderResult>(resolve =>
    setTimeout(() => resolve({ experiences: [], source: 'timeout' }), WALL_CLOCK_MS)
  );

  // Collect all results that arrive within the cap; return first non-empty
  const allWithTimeout: Promise<ProviderResult>[] = [...candidates.map(p =>
    p.catch(err => {
      console.warn('[aggregateExperiences] provider error:', String(err));
      return { experiences: [], source: 'error' };
    })
  ), timeout];

  // Use Promise.race to get the FIRST provider that returns results
  // If it returns empty, settle all remaining promises for a chance at results
  const firstResult = await Promise.race(allWithTimeout);

  let best: ProviderResult = firstResult;
  if (firstResult.experiences.length === 0 && firstResult.source !== 'timeout' && candidates.length > 1) {
    // First provider returned empty — wait for remaining ones, bounded by the SAME
    // timeout sentinel (which is still in flight, counting from function start).
    const all = await Promise.allSettled(allWithTimeout);
    for (const r of all) {
      if (r.status === 'fulfilled' && r.value.experiences.length > 0 && r.value.source !== 'timeout') {
        best = r.value;
        break;
      }
    }
  }

  const result = { experiences: best.experiences, sources: best.source !== 'timeout' && best.source !== 'error' ? [best.source] : [], errors: [] };

  // ── Cache the result (even empty — avoids repeat slow requests) ────────────
  if (best.source !== 'timeout') {
    EXPERIENCE_CACHE.set(cacheKey, { data: result.experiences, sources: result.sources, ts: Date.now() });
    // Evict oldest entries if cache grows large
    if (EXPERIENCE_CACHE.size > 200) {
      const oldest = [...EXPERIENCE_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      EXPERIENCE_CACHE.delete(oldest[0]);
    }
  }

  return result;
}
