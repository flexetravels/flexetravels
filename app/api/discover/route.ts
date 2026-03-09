// ─── /api/discover — Daily-cached trending destinations, events & experiences ──
// Uses Gemini 2.0 Flash to generate fresh content once per day, keyed by date+region.
// Falls back to curated static data if Gemini is unavailable.

import { NextRequest, NextResponse } from 'next/server';
import { geminiGenerate } from '@/lib/ai/gemini';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DiscoverCard {
  id:          string;
  type:        'destination' | 'event' | 'experience';
  title:       string;
  subtitle:    string;
  destination: string;
  country:     string;
  image:       string;
  duration?:   string;
  badge?:      string;
  tags:        string[];
  prompt:      string;
}

export interface DiscoverData {
  region:       string;
  generatedAt:  string;
  destinations: DiscoverCard[];
  events:       DiscoverCard[];
  experiences:  DiscoverCard[];
}

// ── Daily in-memory cache ────────────────────────────────────────────────────
// key = "YYYY-MM-DD:REGION"  |  resets automatically next calendar day
const cache = new Map<string, DiscoverData>();

function todayKey(region: string): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}:${region}`;
}

// ── Unsplash image fetch ─────────────────────────────────────────────────────
const FALLBACK_IMAGES: Record<string, string> = {
  beach:     'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop',
  city:      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=600&fit=crop',
  mountain:  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&h=600&fit=crop',
  concert:   'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&h=600&fit=crop',
  festival:  'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&h=600&fit=crop',
  adventure: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&h=600&fit=crop',
  wellness:  'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&h=600&fit=crop',
  default:   'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&h=600&fit=crop',
};

async function fetchUnsplashImage(query: string): Promise<string> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return FALLBACK_IMAGES.default;
  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape`,
      {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(6_000),
      }
    );
    if (!res.ok) throw new Error(`Unsplash ${res.status}`);
    const data = await res.json() as { urls: { regular: string } };
    return `${data.urls.regular}&w=800&h=600&fit=crop`;
  } catch {
    // Pick a deterministic fallback based on the query text
    if (/beach|island|ocean|sea|coast/i.test(query))   return FALLBACK_IMAGES.beach;
    if (/concert|music|festival|live/i.test(query))    return FALLBACK_IMAGES.concert;
    if (/mountain|hike|trek|alpine/i.test(query))      return FALLBACK_IMAGES.mountain;
    if (/yoga|spa|wellness|retreat/i.test(query))      return FALLBACK_IMAGES.wellness;
    if (/adventure|sport|extreme/i.test(query))        return FALLBACK_IMAGES.adventure;
    if (/city|urban|skyline|street/i.test(query))      return FALLBACK_IMAGES.city;
    return FALLBACK_IMAGES.default;
  }
}

// ── Detect region from Vercel/Cloudflare headers ─────────────────────────────
function detectRegion(req: NextRequest): string {
  // Vercel sets x-vercel-ip-country; Cloudflare sets cf-ipcountry
  return (
    req.headers.get('x-vercel-ip-country') ??
    req.headers.get('cf-ipcountry') ??
    'US'
  );
}

// ── Gemini generation ────────────────────────────────────────────────────────
interface RawCard {
  title:       string;
  subtitle:    string;
  destination: string;
  country:     string;
  imageQuery:  string;
  duration?:   string;
  badge?:      string;
  tags:        string[];
  prompt:      string;
}

interface GeminiDiscoverResponse {
  destinations: RawCard[];
  events:       RawCard[];
  experiences:  RawCard[];
}

async function generateFromGemini(region: string, today: string): Promise<GeminiDiscoverResponse> {
  const regionLabel =
    region === 'CA' ? 'Canada' :
    region === 'US' ? 'United States' :
    'North America';

  const prompt = `Today is ${today}. Generate trending travel discovery content for users in ${regionLabel}.

Return ONLY a valid JSON object — no markdown, no code fences, no explanation — matching this exact structure:
{
  "destinations": [
    {
      "title": "Trip concept title (e.g. 'Island Hopping in Greece')",
      "subtitle": "One compelling sentence why this is trending RIGHT NOW",
      "destination": "City or region name",
      "country": "Country",
      "imageQuery": "Descriptive Unsplash photo query (e.g. 'Santorini white buildings ocean sunset')",
      "duration": "7 days",
      "badge": "Trending",
      "tags": ["beach", "culture"],
      "prompt": "I want to do island hopping in Greece for 10 days in May, flying from Toronto. What are the best islands? Can you find flights and hotels?"
    }
  ],
  "events": [
    {
      "title": "Event name",
      "subtitle": "One exciting sentence about it",
      "destination": "Host city",
      "country": "Country",
      "imageQuery": "Unsplash query for venue/event atmosphere",
      "badge": "Concert",
      "tags": ["music", "live"],
      "prompt": "I want to attend [event name] in [city] in [month from today]. Find me flights from [North American city] and hotels near the venue."
    }
  ],
  "experiences": [
    {
      "title": "Experience title",
      "subtitle": "Why everyone's talking about it",
      "destination": "Location",
      "country": "Country",
      "imageQuery": "Unsplash query",
      "duration": "5 days",
      "badge": "Adventure",
      "tags": ["nature", "outdoors"],
      "prompt": "I want to experience [activity] in [destination] for [N] days. Flying from [North American city]. Can you find flights and packages?"
    }
  ]
}

Rules:
- Generate EXACTLY 6 destinations (mix: beach, city break, culture, adventure, nature, romance)
- Generate EXACTLY 4 events (real or highly plausible: concerts by famous artists, Grand Prix, music festivals, sports championships happening in the next 3 months from ${today})
- Generate EXACTLY 4 experiences (adventure sports, wellness retreats, food journeys, wildlife safaris)
- Departure cities must be real North American airports: Toronto, New York, Vancouver, Los Angeles, Chicago, Montreal, Calgary, Miami, Seattle, Boston
- Trip months: pick upcoming months from ${today} that make sense for the destination's climate
- Prompts must be specific, detailed, and conversational — like a real person asking a travel chatbot
- badge values MUST be one of: Trending | Hot | Popular | Concert | Festival | Sports | F1 | Grand Prix | Adventure | Wellness | Food | Culture | Wildlife | Romance
- Make it feel like a curated travel magazine — current, inspiring, and clickable`;

  const raw = await geminiGenerate(
    prompt,
    'You are a senior travel editor. Respond only with the JSON object requested. No preamble.',
    'gemini-2.0-flash',
    { maxOutputTokens: 4096, temperature: 0.6 }
  );

  // Strip markdown code fences if Gemini wraps the output
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return JSON.parse(cleaned) as GeminiDiscoverResponse;
}

// ── Build DiscoverData from raw cards + Unsplash images ──────────────────────
async function buildDiscoverData(region: string, today: string): Promise<DiscoverData> {
  let raw: GeminiDiscoverResponse;
  try {
    raw = await generateFromGemini(region, today);
  } catch (err) {
    console.error('[discover] Gemini failed, using fallback:', err);
    return getFallbackData(region, today);
  }

  const hydrateCards = async (
    items: RawCard[],
    type: DiscoverCard['type']
  ): Promise<DiscoverCard[]> =>
    Promise.all(
      items.map(async (item, i) => {
        const image = await fetchUnsplashImage(
          item.imageQuery ?? `${item.destination} ${item.country} travel`
        );
        return {
          id:          `${type}-${i}`,
          type,
          title:       item.title       ?? 'Discover',
          subtitle:    item.subtitle    ?? '',
          destination: item.destination ?? '',
          country:     item.country     ?? '',
          image,
          duration:    item.duration,
          badge:       item.badge,
          tags:        Array.isArray(item.tags) ? item.tags : [],
          prompt:      item.prompt      ?? '',
        };
      })
    );

  const [destinations, events, experiences] = await Promise.all([
    hydrateCards(raw.destinations ?? [], 'destination'),
    hydrateCards(raw.events       ?? [], 'event'),
    hydrateCards(raw.experiences  ?? [], 'experience'),
  ]);

  return { region, generatedAt: today, destinations, events, experiences };
}

// ── Static fallback data (curated) ───────────────────────────────────────────
function getFallbackData(region: string, today: string): DiscoverData {
  const dept = region === 'CA' ? 'Toronto' : 'New York';
  const destinations: DiscoverCard[] = [
    { id: 'dest-0', type: 'destination', title: 'Island Hopping in Greece', subtitle: 'Santorini, Mykonos & Rhodes — Europe\'s most photogenic archipelago', destination: 'Santorini', country: 'Greece', image: 'https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?w=800&h=600&fit=crop', duration: '10 days', badge: 'Trending', tags: ['islands', 'romance'], prompt: `I want to do island hopping in Greece — Santorini, Mykonos, and Rhodes — for 10 days in June, flying from ${dept}. Can you find flights and hotels?` },
    { id: 'dest-1', type: 'destination', title: 'Tokyo City Break', subtitle: 'Cherry blossoms, neon streets and world-class ramen', destination: 'Tokyo', country: 'Japan', image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=600&fit=crop', duration: '8 days', badge: 'Popular', tags: ['culture', 'food'], prompt: `Plan a Tokyo city break for 8 days in spring, flying from ${dept}. I want to see Shibuya, Shinjuku, and try the best ramen spots. Find flights and hotels.` },
    { id: 'dest-2', type: 'destination', title: 'Bali Wellness Escape', subtitle: 'Rice terraces, yoga retreats and sacred temples', destination: 'Bali', country: 'Indonesia', image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&h=600&fit=crop', duration: '10 days', badge: 'Hot', tags: ['wellness', 'nature'], prompt: `I want a wellness and relaxation trip to Bali for 10 days. Flying from ${dept}. Can you find flights and a nice resort near Ubud?` },
    { id: 'dest-3', type: 'destination', title: 'Machu Picchu Trek', subtitle: 'Inca Trail to the lost city of the clouds', destination: 'Cusco', country: 'Peru', image: 'https://images.unsplash.com/photo-1587595431973-160d0d94add1?w=800&h=600&fit=crop', duration: '12 days', badge: 'Trending', tags: ['adventure', 'history'], prompt: `I want to hike the Inca Trail and visit Machu Picchu in Peru for 12 days, flying from ${dept}. Find flights and accommodation in Cusco.` },
    { id: 'dest-4', type: 'destination', title: 'Amalfi Coast Drive', subtitle: 'Cliffside villages, limoncello and impossibly blue water', destination: 'Amalfi', country: 'Italy', image: 'https://images.unsplash.com/photo-1612698093158-e07ac200d44e?w=800&h=600&fit=crop', duration: '7 days', badge: 'Popular', tags: ['scenic', 'food'], prompt: `I want to drive the Amalfi Coast in Italy for 7 days in summer, flying from ${dept}. Find flights and hotels in Positano or Ravello.` },
    { id: 'dest-5', type: 'destination', title: 'Iceland Northern Lights', subtitle: 'Geysers, glaciers and the aurora borealis', destination: 'Reykjavik', country: 'Iceland', image: 'https://images.unsplash.com/photo-1520769669658-f07657f5a307?w=800&h=600&fit=crop', duration: '6 days', badge: 'Hot', tags: ['nature', 'aurora'], prompt: `I want to see the Northern Lights in Iceland for 6 days, flying from ${dept}. Find flights and a cosy hotel outside Reykjavik.` },
  ];
  const events: DiscoverCard[] = [
    { id: 'evt-0', type: 'event', title: 'Coachella Valley Music & Arts Festival', subtitle: 'The world\'s most iconic music festival returns to the desert', destination: 'Indio, California', country: 'USA', image: FALLBACK_IMAGES.festival, badge: 'Festival', tags: ['music', 'art'], prompt: `I want to attend Coachella in Indio California this April. Flying from ${dept}. Find flights and hotels in Palm Springs or near the festival grounds.` },
    { id: 'evt-1', type: 'event', title: 'Monaco Grand Prix 2026', subtitle: 'The crown jewel of Formula 1 through the streets of Monte Carlo', destination: 'Monaco', country: 'Monaco', image: FALLBACK_IMAGES.adventure, badge: 'F1', tags: ['motorsport', 'glamour'], prompt: `I want to watch the Monaco Grand Prix in May. Flying from ${dept}. Find flights to Nice and hotels in Monaco or nearby.` },
    { id: 'evt-2', type: 'event', title: 'Tomorrowland Belgium', subtitle: 'Europe\'s most magical electronic music festival', destination: 'Boom', country: 'Belgium', image: FALLBACK_IMAGES.concert, badge: 'Festival', tags: ['EDM', 'festival'], prompt: `I want to attend Tomorrowland in Belgium in July. Flying from ${dept}. Find flights to Brussels and hotels near Boom.` },
    { id: 'evt-3', type: 'event', title: 'Wimbledon Championships', subtitle: 'Strawberries, cream and the greatest grass court tennis', destination: 'London', country: 'United Kingdom', image: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?w=800&h=600&fit=crop', badge: 'Sports', tags: ['tennis', 'sport'], prompt: `I want to attend Wimbledon in London in July. Flying from ${dept}. Find flights and hotels near SW London.` },
  ];
  const experiences: DiscoverCard[] = [
    { id: 'exp-0', type: 'experience', title: 'Safari in the Serengeti', subtitle: 'Witness the Great Migration — nature\'s most dramatic spectacle', destination: 'Serengeti', country: 'Tanzania', image: FALLBACK_IMAGES.adventure, duration: '8 days', badge: 'Wildlife', tags: ['safari', 'wildlife'], prompt: `I want to go on a safari in the Serengeti Tanzania for 8 days. Flying from ${dept}. What's the best time to see the Great Migration? Find flights and a lodge.` },
    { id: 'exp-1', type: 'experience', title: 'Yoga Retreat in Rishikesh', subtitle: 'The yoga capital of the world nestled in the Himalayas', destination: 'Rishikesh', country: 'India', image: FALLBACK_IMAGES.wellness, duration: '7 days', badge: 'Wellness', tags: ['yoga', 'meditation'], prompt: `I want to do a yoga and meditation retreat in Rishikesh India for 7 days. Flying from ${dept}. Find flights to Delhi and a well-rated ashram or retreat centre.` },
    { id: 'exp-2', type: 'experience', title: 'Northern Spain Food Tour', subtitle: 'Pintxos, Rioja wine and Michelin stars in the Basque Country', destination: 'San Sebastián', country: 'Spain', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop', duration: '6 days', badge: 'Food', tags: ['gastronomy', 'wine'], prompt: `I want to do a food and wine tour in the Basque Country Spain for 6 days. Flying from ${dept}. Find flights to Bilbao and hotels in San Sebastián.` },
    { id: 'exp-3', type: 'experience', title: 'Heli-Skiing in British Columbia', subtitle: 'Untouched powder in the Cariboo and Monashee ranges', destination: 'Revelstoke', country: 'Canada', image: FALLBACK_IMAGES.mountain, duration: '5 days', badge: 'Adventure', tags: ['skiing', 'heli-ski'], prompt: `I want to do heli-skiing in British Columbia Canada near Revelstoke for 5 days this winter. Find flights and a ski lodge package.` },
  ];
  return { region, generatedAt: today, destinations, events, experiences };
}

// ── GET handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const region = detectRegion(req);
  const today  = new Date().toISOString().split('T')[0];
  const key    = todayKey(region);

  // Return from cache if available
  const cached = cache.get(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'X-Discover-Cache': 'HIT', 'X-Discover-Region': region },
    });
  }

  // Generate fresh data
  const data = await buildDiscoverData(region, today);
  cache.set(key, data);

  return NextResponse.json(data, {
    headers: { 'X-Discover-Cache': 'MISS', 'X-Discover-Region': region },
  });
}
