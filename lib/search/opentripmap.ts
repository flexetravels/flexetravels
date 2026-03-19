// ─── OpenTripMap Experiences Provider ─────────────────────────────────────────
// Free POI/activity data for 600k+ places worldwide
// Docs: https://dev.opentripmap.org/docs
// Free tier: 5,000 API calls/day
// No booking — discovery only (Viator will handle bookable experiences later)

import type { ExperienceProvider, ExperienceSearchParams, NormalizedExperience } from './types';

const OTM_BASE = 'https://api.opentripmap.com/0.1/en';

// ─── OpenTripMap raw response types ────────────────────────────────────────────
interface OtmGeoname {
  name:      string;
  lon:       number;
  lat:       number;
  country:   string;
  timezone?: string;
}

interface OtmPlace {
  xid:      string;
  name:     string;
  dist?:    number;
  rate?:    number;   // 0–3 popularity/importance
  kinds:    string;
  point:    { lon: number; lat: number };
}

interface OtmPlaceDetail {
  xid:         string;
  name:        string;
  kinds:       string;
  rate?:       number;
  image?:      string;
  preview?:    { source?: string };
  wikipedia_extracts?: { text?: string; html?: string };
  address?:    { road?: string; suburb?: string; city?: string; country?: string };
  point?:      { lon: number; lat: number };
}

// ─── Kinds → Friendly category mapping ────────────────────────────────────────
// OpenTripMap uses comma-separated kinds like "cultural,museums,architecture"
function mapKinds(kinds: string): string {
  const k = kinds.toLowerCase();
  if (k.includes('museum'))                          return 'Museum';
  if (k.includes('beach') || k.includes('aquatic')) return 'Beach';
  if (k.includes('natural') || k.includes('park') ||
      k.includes('reserve') || k.includes('forest')) return 'Nature';
  if (k.includes('cultural') || k.includes('historic') ||
      k.includes('heritage'))                        return 'Culture';
  if (k.includes('architecture') || k.includes('monument') ||
      k.includes('memorial'))                        return 'Landmark';
  if (k.includes('amusement') || k.includes('entertainment') ||
      k.includes('theatre') || k.includes('cinema')) return 'Entertainment';
  if (k.includes('sport') || k.includes('stadium'))  return 'Sport';
  if (k.includes('religion') || k.includes('church') ||
      k.includes('temple') || k.includes('mosque'))  return 'Landmark';
  if (k.includes('food') || k.includes('eat'))       return 'Food & Drink';
  if (k.includes('view') || k.includes('panorama'))  return 'Viewpoint';
  return 'Attraction';
}

// Map category filter → OpenTripMap kinds string
function mapCategoryToKinds(category?: string): string {
  switch (category) {
    case 'cultural':      return 'cultural,museums,historic';
    case 'natural':       return 'natural,parks,beaches';
    case 'adventure':     return 'sport,outdoor_activities,water_sports';
    case 'entertainment': return 'amusements,theatres_and_entertainments';
    case 'food':          return 'foods';
    default:              return 'interesting_places';
  }
}

// ─── OpenTripMap Provider ──────────────────────────────────────────────────────
export class OpenTripMapProvider implements ExperienceProvider {
  readonly name = 'opentripmap';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchExperiences(params: ExperienceSearchParams): Promise<NormalizedExperience[]> {
    const limit   = params.limit   ?? 10;
    const radius  = params.radius  ?? 10000; // 10km default
    const kinds   = mapCategoryToKinds(params.category);

    // ── Step 1: Resolve city to coordinates via geoname ───────────────────────
    const geoRes = await fetch(
      `${OTM_BASE}/places/geoname?name=${encodeURIComponent(params.destination)}&apikey=${this.apiKey}`,
      { signal: AbortSignal.timeout(8_000) }
    );

    if (!geoRes.ok) {
      throw new Error(`OpenTripMap geoname ${geoRes.status} for "${params.destination}"`);
    }

    const geo = await geoRes.json() as OtmGeoname;
    if (!geo?.lat || !geo?.lon) {
      throw new Error(`OpenTripMap: no coordinates for "${params.destination}"`);
    }

    // ── Step 2: Get POIs within radius ─────────────────────────────────────────
    const placesUrl =
      `${OTM_BASE}/places/radius` +
      `?radius=${radius}` +
      `&lon=${geo.lon}&lat=${geo.lat}` +
      `&kinds=${encodeURIComponent(kinds)}` +
      `&rate=2` +                           // Only well-known places (rate 2–3)
      `&format=json` +
      `&limit=${limit * 2}` +               // Fetch extra to allow filtering
      `&apikey=${this.apiKey}`;

    const placesRes = await fetch(placesUrl, { signal: AbortSignal.timeout(10_000) });

    if (!placesRes.ok) {
      throw new Error(`OpenTripMap radius ${placesRes.status}`);
    }

    const places = await placesRes.json() as OtmPlace[];

    if (!Array.isArray(places) || places.length === 0) {
      return [];
    }

    // ── Step 3: Fetch details for top places (parallel, max 6) ───────────────
    // We fetch details in parallel for the first `limit` named places
    const namedPlaces = places
      .filter(p => p.name && p.name.trim().length > 2)
      .slice(0, limit);

    const detailResults = await Promise.allSettled(
      namedPlaces.map(place =>
        fetch(
          `${OTM_BASE}/places/xid/${encodeURIComponent(place.xid)}?apikey=${this.apiKey}`,
          { signal: AbortSignal.timeout(8_000) }
        ).then(r => r.ok ? (r.json() as Promise<OtmPlaceDetail>) : null)
      )
    );

    const experiences: NormalizedExperience[] = [];

    for (let i = 0; i < namedPlaces.length; i++) {
      const place = namedPlaces[i];
      const result = detailResults[i];
      const detail: OtmPlaceDetail | null =
        result.status === 'fulfilled' ? (result.value as OtmPlaceDetail | null) : null;

      const description =
        detail?.wikipedia_extracts?.text?.slice(0, 200) ??
        detail?.wikipedia_extracts?.html?.replace(/<[^>]+>/g, '').slice(0, 200);

      const image =
        detail?.preview?.source ??
        detail?.image ??
        undefined;

      // Normalize rate 0–3 to 0–5 scale
      const rawRate = detail?.rate ?? place.rate ?? 0;
      const rating  = Math.round((rawRate / 3) * 5 * 10) / 10;

      experiences.push({
        id:          place.xid,
        provider:    'opentripmap',
        name:        detail?.name ?? place.name,
        category:    mapKinds(detail?.kinds ?? place.kinds ?? ''),
        description: description || undefined,
        location:    detail?.address?.city ?? params.destination,
        city:        params.destination,
        image,
        rating:      rating > 0 ? rating : undefined,
        bookable:    false,
        coordinates: {
          lat: detail?.point?.lat ?? place.point?.lat ?? geo.lat,
          lon: detail?.point?.lon ?? place.point?.lon ?? geo.lon,
        },
      });
    }

    // Deduplicate by name, filter out nameless entries
    const seen = new Set<string>();
    return experiences.filter(e => {
      const key = e.name.toLowerCase().trim();
      if (!key || key.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
