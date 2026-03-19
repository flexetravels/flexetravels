// ─── Foursquare Places API v3 — Experience Provider ──────────────────────────
// Docs: https://location.foursquare.com/developer/reference/place-search
// Free tier: 1,000 API calls/day
// Auth: Authorization header with API key (no OAuth needed for Places Search)

import type { ExperienceProvider, ExperienceSearchParams, NormalizedExperience } from './types';

const FSQ_BASE = 'https://api.foursquare.com/v3';

// ─── Foursquare category IDs → friendly labels ────────────────────────────────
// Top-level category groups we care about for travel experiences
const CATEGORY_MAP: Record<number, string> = {
  // Arts & Entertainment
  10000: 'Arts & Entertainment', 10027: 'Museum', 10028: 'Music Venue',
  10029: 'Nightlife', 10058: 'Theme Park', 10024: 'Historic Site',
  10025: 'Movie Theatre', 10009: 'Aquarium', 10010: 'Art Gallery',
  // Landmarks & Outdoors
  16000: 'Landmark', 16032: 'Landmark', 16019: 'Park',
  16020: 'Beach', 16021: 'Nature Reserve', 16034: 'Scenic Lookout',
  16035: 'Waterfall', 16017: 'Mountain', 16041: 'Garden',
  // Sports & Recreation
  18000: 'Adventure', 18021: 'Outdoor Activity', 18057: 'Water Sport',
  18028: 'Hiking Trail', 18052: 'Ski Area',
  // Food & Drink (notable spots)
  13000: 'Food & Drink', 13065: 'Restaurant',
};

function mapFoursquareCategory(categories: Array<{ id: number; name: string }>): string {
  if (!categories || categories.length === 0) return 'Attraction';
  // Try most specific first
  for (const cat of categories) {
    const mapped = CATEGORY_MAP[cat.id];
    if (mapped) return mapped;
    // Use category name directly if it's descriptive
    if (cat.name && cat.name.length < 30) return cat.name;
  }
  return categories[0]?.name ?? 'Attraction';
}

// Foursquare category filter IDs for experience-oriented searches
const CATEGORY_FILTERS: Record<string, string> = {
  cultural:      '10000,10024,10027,16032', // arts/entertainment + historic + museums + landmarks
  natural:       '16000,16019,16020,16021,16034,16035,16017,16041', // outdoors
  adventure:     '18000,18021,18028,18052,18057',
  entertainment: '10000,10029,10058',       // arts + nightlife + theme parks
  food:          '13000,13065',
  all:           '10000,16000,18000,13000', // broad sweep
};

// ─── Foursquare raw response types ────────────────────────────────────────────
interface FsqCategory {
  id:   number;
  name: string;
  icon?: { prefix: string; suffix: string };
}

interface FsqPhoto {
  id:      string;
  prefix:  string;
  suffix:  string;
  width?:  number;
  height?: number;
}

interface FsqPlace {
  fsq_id:      string;
  name:        string;
  categories?: FsqCategory[];
  location?:   { formatted_address?: string; locality?: string; country?: string };
  rating?:     number;    // 0–10
  distance?:   number;    // metres
  photos?:     FsqPhoto[];
  description?: string;
  geocodes?:   { main?: { latitude: number; longitude: number } };
}

// ─── Foursquare Provider ──────────────────────────────────────────────────────
export class FoursquareProvider implements ExperienceProvider {
  readonly name = 'foursquare';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get headers(): HeadersInit {
    return {
      Authorization: this.apiKey,
      Accept:        'application/json',
    };
  }

  async searchExperiences(params: ExperienceSearchParams): Promise<NormalizedExperience[]> {
    const limit      = Math.min(params.limit ?? 10, 20);
    const categories = CATEGORY_FILTERS[params.category ?? 'all'] ?? CATEGORY_FILTERS['all'];

    // ── Places search near the city ──────────────────────────────────────────
    const url = new URL(`${FSQ_BASE}/places/search`);
    url.searchParams.set('near',       params.destination);
    url.searchParams.set('categories', categories);
    url.searchParams.set('limit',      String(limit));
    // Request specific fields including photos
    url.searchParams.set('fields', 'fsq_id,name,categories,location,rating,photos,description,geocodes');
    // Sort by popularity for best results
    url.searchParams.set('sort', 'POPULARITY');

    const res = await fetch(url.toString(), {
      headers: this.headers,
      signal:  AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Foursquare ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json() as { results?: FsqPlace[] };
    const places = data.results ?? [];

    const experiences: NormalizedExperience[] = [];

    for (const place of places) {
      if (!place.name?.trim()) continue;

      // Build photo URL: Foursquare uses prefix + size + suffix pattern
      const photo = place.photos?.[0];
      const image = photo
        ? `${photo.prefix}400x300${photo.suffix}`
        : undefined;

      // Rating: Foursquare uses 0–10 scale, convert to 0–5
      const rating = place.rating ? Math.round((place.rating / 10) * 5 * 10) / 10 : undefined;

      experiences.push({
        id:          place.fsq_id,
        provider:    'foursquare',
        name:        place.name,
        category:    mapFoursquareCategory(place.categories ?? []),
        description: place.description?.slice(0, 200),
        location:    place.location?.formatted_address ?? params.destination,
        city:        place.location?.locality ?? params.destination,
        image,
        rating,
        bookable:    false,   // Foursquare is discovery only; Viator will handle booking
        coordinates: place.geocodes?.main
          ? { lat: place.geocodes.main.latitude, lon: place.geocodes.main.longitude }
          : undefined,
      });
    }

    // Deduplicate by name
    const seen = new Set<string>();
    return experiences.filter(e => {
      const key = e.name.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
