// ─── Destination itinerary generator (Gemini 2.5 Pro + Google Places) ────────
// Strategy:
//   1. Ask Gemini 2.5 Pro for a day-by-day plan, grounded in Google Search so
//      hours/openings/recent events stay current. Output is structured JSON.
//   2. For each suggested item, look it up in Google Places to attach a real
//      photo, lat/lon, current rating, and hours. Items that don't resolve
//      stay on the list — they just render without the Places badge.
//   3. Cache the merged result for 24h keyed on (city, days, interests).
//
// Why this stack:
//   - Gemini's google_search grounding is the one place Google's AI is
//     genuinely better than Anthropic — no Claude equivalent today.
//   - Places API New (places.googleapis.com/v1) returns photos + ratings in
//     one request, no Photos API roundtrip needed.
//   - Both are gated on env keys; missing keys fail soft (returns null) so
//     the endpoint can 503 without the helper exploding.
//
// Cost ballpark at 100 trips/day with full 4-day itineraries:
//   Gemini grounded: ~$1/day · Places: ~$1.20/day · ~$70/month total.

const TTL_MS      = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const GEMINI_MODEL  = 'gemini-2.5-pro';
const GEMINI_HOST   = 'https://generativelanguage.googleapis.com';
const PLACES_HOST   = 'https://places.googleapis.com';
const WIKIVOYAGE_HOST = 'https://en.wikivoyage.org';
const WIKIPEDIA_HOST = 'https://en.wikipedia.org';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ItineraryCategory =
  | 'attraction' | 'food' | 'museum' | 'outdoor' | 'shopping' | 'nightlife' | 'experience';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ItineraryItem {
  name:           string;
  why:            string;
  category:       ItineraryCategory;
  timeOfDay?:     TimeOfDay;
  durationMinutes?: number;

  // Google Places enrichment (only present if the place resolved)
  placeId?:       string;
  rating?:        number;          // Google's 0–5
  ratingCount?:   number;
  photo?:         string;          // first photo URL (or undefined)
  lat?:           number;
  lon?:           number;
  address?:       string;
  hours?:         string[];        // weekday text from Places
  priceLevel?:    0 | 1 | 2 | 3 | 4;
  websiteUrl?:    string;
  mapsUrl?:       string;          // canonical Google Maps deeplink
}

export interface ItineraryDay {
  day:    number;        // 1-indexed
  items:  ItineraryItem[];
}

export interface DestinationItinerary {
  city:        string;
  days:        ItineraryDay[];
  generatedAt: number;
  // Where the suggestions came from. 'fallback' means we returned a stub
  // because Gemini was unavailable or returned unparseable output.
  source:      'gemini-grounded' | 'gemini' | 'fallback';
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheValue extends DestinationItinerary {
  ts: number;
}

const cache = new Map<string, CacheValue>();
const pending = new Map<string, Promise<DestinationItinerary | null>>();
let hitCount = 0, missCount = 0, storeCount = 0;

function cacheKey(city: string, days: number, interests: string[]): string {
  const norm = city.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
  const sortedInterests = (interests ?? []).slice().sort().join(',');
  return `${norm}|${days}|${sortedInterests}`;
}

function lookup(key: string): DestinationItinerary | null {
  const entry = cache.get(key);
  if (!entry) { missCount++; return null; }
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    missCount++;
    return null;
  }
  hitCount++;
  const { ts: _ts, ...rest } = entry;
  return rest;
}

function store(key: string, value: DestinationItinerary): void {
  cache.set(key, { ...value, ts: Date.now() });
  storeCount++;
  if (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs  = Infinity;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

// ─── Gemini call ────────────────────────────────────────────────────────────

interface GeminiPart      { text?: string }
interface GeminiCandidate { content?: { parts?: GeminiPart[] } }
interface GeminiResponse  { candidates?: GeminiCandidate[] }

interface RawGeminiItem {
  name?:            string;
  why?:             string;
  category?:        string;
  timeOfDay?:       string;
  durationMinutes?: number;
}
interface RawGeminiDay  { day?: number; items?: RawGeminiItem[] }
interface RawGeminiResp { days?: RawGeminiDay[] }

const SYSTEM_PROMPT =
  'You are a knowledgeable local travel guide. You return concise, opinionated, ' +
  'modern recommendations — the things a savvy traveler would actually do, not ' +
  'the bus-tour checklist. Use Google Search grounding to verify openings, ' +
  'hours, and recent closures before recommending. Skip anything currently ' +
  'closed for renovation or seasonal closure.';

function buildPrompt(city: string, days: number, interests: string[]): string {
  const interestLine = interests.length
    ? `The traveler is interested in: ${interests.join(', ')}. Bias recommendations accordingly.`
    : 'Bias recommendations toward what makes this destination distinctive.';
  return `Plan a ${days}-day itinerary for ${city}.

${interestLine}

For each day, give 3–4 items spread across morning / afternoon / evening. For each item:
  - "name": the actual place name (no editorial titles like "Visit X")
  - "why": one sentence on why it suits this trip
  - "category": one of attraction|food|museum|outdoor|shopping|nightlife|experience
  - "timeOfDay": morning|afternoon|evening|night
  - "durationMinutes": rough visit length

Return ONLY valid JSON in this exact shape, no commentary, no markdown fences:
{
  "days": [
    { "day": 1, "items": [ { "name": "...", "why": "...", "category": "...", "timeOfDay": "...", "durationMinutes": 90 }, ... ] },
    ...
  ]
}`;
}

// Strip markdown code fences and trailing commentary so JSON.parse succeeds
// on outputs that ignored the "no markdown" instruction.
function extractJson(text: string): string | null {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  // Pull from the first { to the last } — Gemini sometimes adds preamble.
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return cleaned.slice(first, last + 1);
}

async function callGemini(
  city: string,
  days: number,
  interests: string[],
  apiKey: string,
): Promise<{ raw: RawGeminiResp; grounded: boolean } | null> {
  const url = `${GEMINI_HOST}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // We try grounding first (more accurate, current openings). If grounding is
  // rejected (some Gemini API tiers don't support it together with structured
  // output), we retry without the tool — still good, just less current.
  for (const useGrounding of [true, false]) {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents:          [{ role: 'user', parts: [{ text: buildPrompt(city, days, interests) }] }],
      generationConfig: {
        temperature:        0.4,
        maxOutputTokens:    2048,
        responseMimeType:   'application/json',
      },
    };
    if (useGrounding) body.tools = [{ google_search: {} }];

    let res: Response;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.warn('[itinerary] Gemini fetch threw:', e instanceof Error ? e.message : String(e));
      continue;
    }
    if (!res.ok) {
      // 400 commonly means grounding is incompatible with this prompt config
      // — let the next iteration try without tools.
      const errText = await res.text().catch(() => '');
      console.warn('[itinerary] Gemini', res.status, errText.slice(0, 200));
      continue;
    }

    const json = await res.json().catch(() => null) as GeminiResponse | null;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) continue;

    const jsonText = extractJson(text);
    if (!jsonText) continue;

    try {
      const parsed = JSON.parse(jsonText) as RawGeminiResp;
      if (parsed?.days && Array.isArray(parsed.days)) {
        return { raw: parsed, grounded: useGrounding };
      }
    } catch {
      // fall through to retry-without-grounding
    }
  }
  return null;
}

// ─── Google Places enrichment ───────────────────────────────────────────────

interface PlacesPhoto { name?: string }
interface PlacesPlace {
  id?:                 string;
  displayName?:        { text?: string };
  formattedAddress?:   string;
  location?:           { latitude?: number; longitude?: number };
  rating?:             number;
  userRatingCount?:    number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  photos?:             PlacesPhoto[];
  priceLevel?:         string;          // PRICE_LEVEL_FREE | INEXPENSIVE | MODERATE | EXPENSIVE | VERY_EXPENSIVE
  websiteUri?:         string;
  googleMapsUri?:      string;
}
interface PlacesSearchResponse { places?: PlacesPlace[] }

const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.photos.name',
  'places.priceLevel',
  'places.websiteUri',
  'places.googleMapsUri',
].join(',');

function priceLevelFromString(s: string | undefined): 0 | 1 | 2 | 3 | 4 | undefined {
  switch (s) {
    case 'PRICE_LEVEL_FREE':           return 0;
    case 'PRICE_LEVEL_INEXPENSIVE':    return 1;
    case 'PRICE_LEVEL_MODERATE':       return 2;
    case 'PRICE_LEVEL_EXPENSIVE':      return 3;
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4;
    default:                           return undefined;
  }
}

// Photo URL pattern (Places New): `${PLACES_HOST}/v1/${photo.name}/media?maxHeightPx=...&key=...`
function placesPhotoUrl(photoName: string, apiKey: string): string {
  return `${PLACES_HOST}/v1/${photoName}/media?maxHeightPx=400&maxWidthPx=600&key=${apiKey}`;
}

async function searchPlace(
  itemName: string,
  city: string,
  apiKey: string,
): Promise<PlacesPlace | null> {
  const url = `${PLACES_HOST}/v1/places:searchText`;
  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery:  `${itemName} ${city}`,
        maxResultCount: 1,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = await res.json().catch(() => null) as PlacesSearchResponse | null;
  return json?.places?.[0] ?? null;
}

async function searchPlaces(
  query: string,
  apiKey: string,
  maxResultCount = 8,
): Promise<PlacesPlace[]> {
  const url = `${PLACES_HOST}/v1/places:searchText`;
  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: Math.max(1, Math.min(12, maxResultCount)),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const json = await res.json().catch(() => null) as PlacesSearchResponse | null;
  return Array.isArray(json?.places) ? json.places : [];
}

function enrichItem(item: ItineraryItem, place: PlacesPlace | null, apiKey: string): ItineraryItem {
  if (!place) return item;
  const firstPhoto = place.photos?.[0]?.name;
  return {
    ...item,
    placeId:     place.id,
    rating:      place.rating,
    ratingCount: place.userRatingCount,
    photo:       firstPhoto ? placesPhotoUrl(firstPhoto, apiKey) : item.photo,
    lat:         place.location?.latitude,
    lon:         place.location?.longitude,
    address:     place.formattedAddress,
    hours:       place.regularOpeningHours?.weekdayDescriptions,
    priceLevel:  priceLevelFromString(place.priceLevel),
    websiteUrl:  place.websiteUri,
    mapsUrl:     place.googleMapsUri,
  };
}

function placeToItem(place: PlacesPlace, city: string, apiKey: string, index: number): ItineraryItem | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;
  const rating = place.rating;
  const count = place.userRatingCount;
  const firstPhoto = place.photos?.[0]?.name;
  const timeOfDay: TimeOfDay = index % 3 === 0 ? 'morning' : index % 3 === 1 ? 'afternoon' : 'evening';
  return {
    name: name.slice(0, 120),
    why: rating && count
      ? `Highly rated by Google users in ${city}, with ${rating.toFixed(1)} stars from ${count.toLocaleString()} reviews.`
      : `A live Google Places pick for ${city}, selected from current place data.`,
    category: index % 3 === 2 ? 'food' : 'attraction',
    timeOfDay,
    durationMinutes: index % 3 === 2 ? 90 : 120,
    placeId:     place.id,
    rating:      place.rating,
    ratingCount: place.userRatingCount,
    photo:       firstPhoto ? placesPhotoUrl(firstPhoto, apiKey) : undefined,
    lat:         place.location?.latitude,
    lon:         place.location?.longitude,
    address:     place.formattedAddress,
    hours:       place.regularOpeningHours?.weekdayDescriptions,
    priceLevel:  priceLevelFromString(place.priceLevel),
    websiteUrl:  place.websiteUri,
    mapsUrl:     place.googleMapsUri,
  };
}

async function placesOnlyItinerary(
  city: string,
  days: number,
  interests: string[],
  apiKey: string,
): Promise<DestinationItinerary | null> {
  const baseQueries = [
    `best things to do in ${city}`,
    `top attractions in ${city}`,
    `best local food in ${city}`,
    `museums parks shopping nightlife in ${city}`,
  ];
  const interestQueries = interests
    .map(i => i.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map(i => `${i} experiences in ${city}`);
  const queries = Array.from(new Set([...interestQueries, ...baseQueries])).slice(0, 6);

  const batches = await Promise.all(queries.map(q => searchPlaces(q, apiKey, 8)));
  const seen = new Set<string>();
  const items: ItineraryItem[] = [];
  for (const place of batches.flat()) {
    const id = place.id ?? place.displayName?.text?.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item = placeToItem(place, city, apiKey, items.length);
    if (item) items.push(item);
    if (items.length >= days * 4) break;
  }
  if (items.length === 0) return null;

  const outDays: ItineraryDay[] = Array.from({ length: days }, (_, i) => {
    const start = i * 3;
    const slice = items.slice(start, start + 3);
    return { day: i + 1, items: slice.length > 0 ? slice : items.slice(0, Math.min(3, items.length)) };
  }).filter(d => d.items.length > 0);

  return {
    city,
    days: outDays,
    generatedAt: Date.now(),
    source: 'fallback',
  };
}

// ─── No-key live fallback: Wikivoyage ───────────────────────────────────────

interface WikiSearchResponse {
  query?: { search?: Array<{ title?: string; pageid?: number; snippet?: string }> };
}
interface WikiParseSectionsResponse {
  parse?: { title?: string; sections?: Array<{ index?: string; line?: string }> };
}
interface WikiParseTextResponse {
  parse?: { text?: { '*': string } };
}
interface WikiPageResponse {
  query?: {
    pages?: Record<string, {
      pageid?: number;
      title?: string;
      coordinates?: Array<{ lat?: number; lon?: number }>;
      description?: string;
      extract?: string;
      thumbnail?: { source?: string };
    }>;
  };
}
interface WikiGeoSearchResponse {
  query?: {
    geosearch?: Array<{ pageid?: number; title?: string; lat?: number; lon?: number }>;
  };
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryForSection(section: string): ItineraryCategory {
  const s = section.toLowerCase();
  if (s.includes('eat') || s.includes('drink')) return 'food';
  if (s.includes('do')) return 'experience';
  if (s.includes('buy')) return 'shopping';
  return 'attraction';
}

function looksTravelRelevant(title: string, description?: string, extract?: string): boolean {
  const text = `${title} ${description ?? ''} ${extract ?? ''}`.toLowerCase();
  if (/^(tourism in|list of)/i.test(title)) return false;
  if (/(station|line \d|railway|metro|subway|bus stop|airport terminal|headquarters|government|office|agency|department|company|corporation|archdiocese|worship service|ministry|school|university|hospital|embassy|consulate|district court|police|fire and disaster)/i.test(text)) {
    return false;
  }
  return /(palace|temple|shrine|museum|gallery|market|park|garden|tower|village|neighbou?rhood|street|shopping|beach|mountain|trail|historic|heritage|landmark|cathedral|church|theater|theatre|restaurant|food|nightlife|square|plaza|harbo?r|island|fort|castle|monument|zoo|aquarium)/i.test(text);
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (n: number) => n * Math.PI / 180;
  const r = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

async function fetchWikivoyageJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${WIKIVOYAGE_HOST}${path}`, {
      headers: { 'User-Agent': 'FlexeTravels/1.0 itinerary fallback (support@flexetravels.com)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null) as T | null;
  } catch {
    return null;
  }
}

async function fetchWikipediaJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${WIKIPEDIA_HOST}${path}`, {
      headers: { 'User-Agent': 'FlexeTravels/1.0 itinerary fallback (support@flexetravels.com)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null) as T | null;
  } catch {
    return null;
  }
}

async function resolveWikivoyageTitle(city: string): Promise<string | null> {
  const exact = await fetchWikivoyageJson<WikiParseSectionsResponse>(
    `/w/api.php?action=parse&page=${encodeURIComponent(city)}&prop=sections&format=json&origin=*`,
  );
  if (exact?.parse?.title) return exact.parse.title;

  const searched = await fetchWikivoyageJson<WikiSearchResponse>(
    `/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(city)}&srlimit=1&format=json&origin=*`,
  );
  return searched?.query?.search?.[0]?.title ?? null;
}

async function wikipediaCityCoordinates(city: string): Promise<{ lat: number; lon: number } | null> {
  const pageJson = await fetchWikipediaJson<WikiPageResponse>(
    `/w/api.php?action=query&titles=${encodeURIComponent(city)}&prop=coordinates&format=json&origin=*`,
  );
  const page = Object.values(pageJson?.query?.pages ?? {})[0];
  const coord = page?.coordinates?.[0];
  return typeof coord?.lat === 'number' && typeof coord?.lon === 'number'
    ? { lat: coord.lat, lon: coord.lon }
    : null;
}

async function wikivoyageItinerary(city: string, days: number): Promise<DestinationItinerary | null> {
  const title = await resolveWikivoyageTitle(city);
  if (!title) return null;

  const sectionsJson = await fetchWikivoyageJson<WikiParseSectionsResponse>(
    `/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=sections&format=json&origin=*`,
  );
  const sections = (sectionsJson?.parse?.sections ?? [])
    .filter(s => s.index && /^(see|do|eat|drink|buy)$/i.test((s.line ?? '').trim()))
    .slice(0, 6);
  if (sections.length === 0) return null;

  const items: ItineraryItem[] = [];
  for (const section of sections) {
    const htmlJson = await fetchWikivoyageJson<WikiParseTextResponse>(
      `/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&section=${encodeURIComponent(section.index!)}&format=json&origin=*`,
    );
    const html = htmlJson?.parse?.text?.['*'] ?? '';
    const listItems = html.match(/<li[\s\S]*?<\/li>/gi) ?? [];
    for (const li of listItems) {
      const linkText = li.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];
      const boldText = li.match(/<b[^>]*>([\s\S]*?)<\/b>/i)?.[1];
      const cleaned = stripHtml(li);
      const name = stripHtml(boldText || linkText || cleaned.split(/[.:;-]/)[0] || '').slice(0, 120);
      if (!name || name.length < 3) continue;
      if (items.some(item => item.name.toLowerCase() === name.toLowerCase())) continue;
      const whySentence = cleaned.replace(name, '').split(/(?<=[.!?])\s+/)[0]?.trim();
      items.push({
        name: name.replace(/[.。]+$/, ''),
        why: whySentence && whySentence.length > 12
          ? whySentence.slice(0, 240)
          : `A live Wikivoyage recommendation for ${city}.`,
        category: categoryForSection(section.line ?? 'see'),
        timeOfDay: items.length % 3 === 0 ? 'morning' : items.length % 3 === 1 ? 'afternoon' : 'evening',
        durationMinutes: 90,
      });
      if (items.length >= days * 4) break;
    }
    if (items.length >= days * 4) break;
  }
  if (items.length === 0) return null;

  const outDays: ItineraryDay[] = Array.from({ length: days }, (_, i) => {
    const slice = items.slice(i * 3, i * 3 + 3);
    return { day: i + 1, items: slice.length > 0 ? slice : items.slice(0, Math.min(3, items.length)) };
  }).filter(d => d.items.length > 0);

  return {
    city,
    days: outDays,
    generatedAt: Date.now(),
    source: 'fallback',
  };
}

async function wikipediaNearbyItems(city: string): Promise<ItineraryItem[]> {
  const coord = await wikipediaCityCoordinates(city);
  if (!coord) return [];

  const geoJson = await fetchWikipediaJson<WikiGeoSearchResponse>(
    `/w/api.php?action=query&list=geosearch&gscoord=${coord.lat}%7C${coord.lon}&gsradius=10000&gslimit=40&format=json&origin=*`,
  );
  const ids = (geoJson?.query?.geosearch ?? [])
    .map(p => p.pageid)
    .filter((id): id is number => typeof id === 'number')
    .slice(0, 30);
  if (ids.length === 0) return [];

  const detailJson = await fetchWikipediaJson<WikiPageResponse>(
    `/w/api.php?action=query&pageids=${ids.join('%7C')}&prop=description%7Cextracts%7Cpageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=600&format=json&origin=*`,
  );
  const pages = Object.values(detailJson?.query?.pages ?? {});
  const out: ItineraryItem[] = [];
  for (const p of pages) {
    const title = p.title?.trim();
    if (!title || /^list of /i.test(title) || /disambiguation/i.test(p.description ?? '')) continue;
    if (!looksTravelRelevant(title, p.description, p.extract)) continue;
    const desc = p.description?.trim();
    const extract = p.extract?.trim().split(/(?<=[.!?])\s+/)[0];
    const why = desc
      ? `${desc.charAt(0).toUpperCase()}${desc.slice(1)} near ${city}.`
      : (extract || `A live nearby place from Wikipedia for ${city}.`);
    out.push({
      name: title.slice(0, 120),
      why: why.slice(0, 240),
      category: /park|garden|mountain|beach|river|trail/i.test(title + ' ' + desc) ? 'outdoor'
        : /museum|gallery|palace|temple|shrine|church|historic|heritage/i.test(title + ' ' + desc) ? 'museum'
        : 'attraction',
      timeOfDay: out.length % 3 === 0 ? 'morning' : out.length % 3 === 1 ? 'afternoon' : 'evening',
      durationMinutes: 90,
      photo: p.thumbnail?.source,
      lat: geoJson?.query?.geosearch?.find(g => g.pageid === p.pageid)?.lat,
      lon: geoJson?.query?.geosearch?.find(g => g.pageid === p.pageid)?.lon,
    });
  }
  return out;
}

async function wikipediaSearchItems(city: string): Promise<ItineraryItem[]> {
  const cityCoord = await wikipediaCityCoordinates(city);
  const terms = [
    `${city} tourist attraction`,
    `${city} museum`,
    `${city} park`,
    `${city} palace temple shrine`,
    `${city} market shopping street`,
  ];
  const searchResponses = await Promise.all(terms.map(term => fetchWikipediaJson<WikiSearchResponse>(
    `/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=8&format=json&origin=*`,
  )));
  const ids = Array.from(new Set(searchResponses
    .flatMap(r => r?.query?.search ?? [])
    .map(r => r.pageid)
    .filter((id): id is number => typeof id === 'number')))
    .slice(0, 30);
  if (ids.length === 0) return [];

  const detailJson = await fetchWikipediaJson<WikiPageResponse>(
    `/w/api.php?action=query&pageids=${ids.join('%7C')}&prop=description%7Cextracts%7Cpageimages%7Ccoordinates&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=600&format=json&origin=*`,
  );
  const pages = Object.values(detailJson?.query?.pages ?? {});
  const out: ItineraryItem[] = [];
  for (const p of pages) {
    const title = p.title?.trim();
    if (!title || /^list of /i.test(title) || /disambiguation/i.test(p.description ?? '')) continue;
    if (!looksTravelRelevant(title, p.description, p.extract)) continue;
    const coord = p.coordinates?.[0];
    if (cityCoord && coord?.lat && coord?.lon && distanceKm(cityCoord.lat, cityCoord.lon, coord.lat, coord.lon) > 75) {
      continue;
    }
    if (!coord && !new RegExp(city, 'i').test(`${title} ${p.description ?? ''} ${p.extract ?? ''}`)) {
      continue;
    }
    const desc = p.description?.trim();
    const extract = p.extract?.trim().split(/(?<=[.!?])\s+/)[0];
    const why = desc
      ? `${desc.charAt(0).toUpperCase()}${desc.slice(1)} in ${city}.`
      : (extract || `A live Wikipedia travel-related place for ${city}.`);
    out.push({
      name: title.slice(0, 120),
      why: why.slice(0, 240),
      category: /park|garden|mountain|beach|river|trail/i.test(title + ' ' + desc) ? 'outdoor'
        : /museum|gallery|palace|temple|shrine|church|cathedral|historic|heritage/i.test(title + ' ' + desc) ? 'museum'
        : /market|shopping|street/i.test(title + ' ' + desc) ? 'shopping'
        : 'attraction',
      timeOfDay: out.length % 3 === 0 ? 'morning' : out.length % 3 === 1 ? 'afternoon' : 'evening',
      durationMinutes: 90,
      photo: p.thumbnail?.source,
      lat: p.coordinates?.[0]?.lat,
      lon: p.coordinates?.[0]?.lon,
    });
  }
  return out;
}

async function publicKnowledgeItinerary(city: string, days: number): Promise<DestinationItinerary | null> {
  const [voyage, searched, nearby] = await Promise.all([
    wikivoyageItinerary(city, days),
    wikipediaSearchItems(city),
    wikipediaNearbyItems(city),
  ]);
  const seen = new Set<string>();
  const items: ItineraryItem[] = [];
  for (const item of [...(voyage?.days.flatMap(d => d.items) ?? []), ...searched, ...nearby]) {
    const key = item.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= days * 4) break;
  }
  if (items.length === 0) return null;

  const outDays: ItineraryDay[] = Array.from({ length: days }, (_, i) => {
    const slice = items.slice(i * 3, i * 3 + 3);
    return { day: i + 1, items: slice };
  }).filter(d => d.items.length > 0);

  return {
    city,
    days: outDays,
    generatedAt: Date.now(),
    source: 'fallback',
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchItinerary(
  city:      string,
  daysCount: number,
  interests: string[] = [],
): Promise<DestinationItinerary | null> {
  if (!city || city.trim().length < 2) return null;
  const days = Math.max(1, Math.min(14, Math.floor(daysCount)));

  const key = cacheKey(city, days, interests);
  const cached = lookup(key);
  if (cached) return cached;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const task = generateItinerary(city, days, interests, key);
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

async function generateItinerary(
  city: string,
  days: number,
  interests: string[],
  key: string,
): Promise<DestinationItinerary | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  const hasGemini = Boolean(geminiKey && !geminiKey.includes('PASTE'));
  const hasPlaces = Boolean(placesKey && !placesKey.includes('PASTE'));

  if (!hasGemini) {
    const fallback = (hasPlaces ? await placesOnlyItinerary(city, days, interests, placesKey!) : null)
      ?? await publicKnowledgeItinerary(city, days);
    if (fallback) store(key, fallback);
    return fallback;
  }

  const gem = await callGemini(city, days, interests, geminiKey!);
  if (!gem) {
    const fallback = (hasPlaces ? await placesOnlyItinerary(city, days, interests, placesKey!) : null)
      ?? await publicKnowledgeItinerary(city, days);
    if (fallback) store(key, fallback);
    return fallback;
  }

  // Normalize Gemini output → our shape, dropping malformed entries.
  const validCategories: ItineraryCategory[] = ['attraction','food','museum','outdoor','shopping','nightlife','experience'];
  const validTimes:      TimeOfDay[]         = ['morning','afternoon','evening','night'];

  const normDays: ItineraryDay[] = (gem.raw.days ?? [])
    .filter((d): d is RawGeminiDay => !!d && Array.isArray(d.items))
    .slice(0, days)
    .map((d, i) => ({
      day: typeof d.day === 'number' ? d.day : i + 1,
      items: (d.items ?? [])
        .filter((it): it is RawGeminiItem => !!it && typeof it.name === 'string' && it.name.length > 0)
        .slice(0, 6)
        .map((it): ItineraryItem => ({
          name:            String(it.name).trim().slice(0, 120),
          why:             String(it.why ?? '').trim().slice(0, 280),
          category:        validCategories.includes((it.category ?? '') as ItineraryCategory)
                             ? (it.category as ItineraryCategory)
                             : 'attraction',
          timeOfDay:       validTimes.includes((it.timeOfDay ?? '') as TimeOfDay)
                             ? (it.timeOfDay as TimeOfDay)
                             : undefined,
          durationMinutes: typeof it.durationMinutes === 'number' && it.durationMinutes > 0
                             ? Math.min(720, Math.floor(it.durationMinutes))
                             : undefined,
        })),
    }))
    .filter(d => d.items.length > 0);

  // Enrich with Google Places using bounded concurrency. A 7-day plan can have
  // 30+ items; firing them all at once makes the UI feel stuck and can trip
  // provider throttles. Four workers keeps it responsive and predictable.
  if (hasPlaces) {
    const jobs = normDays.flatMap(d =>
      d.items.map((item, idx) => async () => {
        const place = await searchPlace(item.name, city, placesKey!);
        d.items[idx] = enrichItem(item, place, placesKey!);
      }),
    );
    const workers = Array.from({ length: Math.min(4, jobs.length) }, async (_, workerIdx) => {
      for (let i = workerIdx; i < jobs.length; i += 4) {
        await jobs[i]();
      }
    });
    await Promise.all(workers);
  }

  const out: DestinationItinerary = {
    city,
    days:        normDays,
    generatedAt: Date.now(),
    source:      gem.grounded ? 'gemini-grounded' : 'gemini',
  };

  // Don't cache empty results — we'd rather retry than serve a 0-day plan.
  if (out.days.length === 0) return null;

  store(key, out);
  return out;
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

export function getItineraryCacheStats() {
  return {
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    placesConfigured: !!process.env.GOOGLE_PLACES_API_KEY,
    size:    cache.size,
    hits:    hitCount,
    misses:  missCount,
    stores:  storeCount,
  };
}
