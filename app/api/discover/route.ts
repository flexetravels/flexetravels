// ─── /api/discover — Daily-cached trending destinations, events & experiences ──
// Uses Claude Haiku to generate fresh content once per day, keyed by date+region.
// Falls back to curated static data if Claude is unavailable.

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

async function generateFromClaude(region: string, today: string): Promise<GeminiDiscoverResponse> {
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
- Make it feel like a curated travel magazine — current, inspiring, and clickable
- IMPORTANT — destinations and event/experience host cities MUST be major cities with confirmed hotel inventory. Stick to: Cancun, Punta Cana, Montego Bay, Nassau, San Juan, Mexico City, Cabo San Lucas, Puerto Vallarta; Miami, New York, Las Vegas, Los Angeles, Orlando, Honolulu, Nashville, New Orleans, Chicago, San Francisco; Toronto, Vancouver, Montreal, Whistler; London, Paris, Rome, Barcelona, Madrid, Amsterdam, Vienna, Prague, Lisbon, Athens, Dublin, Florence, Venice, Berlin, Munich, Istanbul; Dubai, Abu Dhabi; Tokyo, Osaka, Bangkok, Phuket, Bali, Singapore, Hong Kong, Seoul; Sydney, Melbourne; Lima, Cusco, Buenos Aires, Rio de Janeiro, Bogota, Cartagena. Do NOT suggest remote rural areas, small islands without major hotels, game reserves, or niche destinations.`;

  const raw = await geminiGenerate(
    prompt,
    'You are a senior travel editor. Respond only with the JSON object requested. No preamble, no markdown, no code fences.',
    undefined,
    { maxOutputTokens: 4096, temperature: 0.6 }
  );

  // Strip markdown code fences if Claude wraps the output
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
    raw = await generateFromClaude(region, today);
  } catch (err) {
    console.error('[discover] Claude failed, using fallback:', err);
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
    { id: 'dest-0', type: 'destination', title: 'Cancún Beach Escape', subtitle: 'Turquoise waters, all-inclusive resorts and ancient Mayan ruins', destination: 'Cancun', country: 'Mexico', image: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=800&h=600&fit=crop', duration: '7 days', badge: 'Trending', tags: ['beach', 'resort'], prompt: `I want a 7 day beach vacation to Cancun Mexico. Flying from ${dept}. Can you find flights and a 5-star all-inclusive resort?` },
    { id: 'dest-1', type: 'destination', title: 'Tokyo City Break', subtitle: 'Cherry blossoms, neon streets and world-class ramen', destination: 'Tokyo', country: 'Japan', image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=600&fit=crop', duration: '8 days', badge: 'Popular', tags: ['culture', 'food'], prompt: `Plan a Tokyo city break for 8 days, flying from ${dept}. I want to see Shibuya, Shinjuku, and try the best ramen spots. Find flights and hotels.` },
    { id: 'dest-2', type: 'destination', title: 'Bali Wellness Escape', subtitle: 'Rice terraces, yoga retreats and sacred temples', destination: 'Bali', country: 'Indonesia', image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&h=600&fit=crop', duration: '10 days', badge: 'Hot', tags: ['wellness', 'nature'], prompt: `I want a wellness and relaxation trip to Bali for 10 days. Flying from ${dept}. Can you find flights and a nice resort near Ubud?` },
    { id: 'dest-3', type: 'destination', title: 'Barcelona & Costa Brava', subtitle: 'Gaudí, tapas and golden Mediterranean beaches', destination: 'Barcelona', country: 'Spain', image: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800&h=600&fit=crop', duration: '7 days', badge: 'Trending', tags: ['culture', 'food'], prompt: `I want a 7 day trip to Barcelona Spain, flying from ${dept}. I want to see Sagrada Família, eat amazing tapas, and visit the beach. Find flights and a great hotel.` },
    { id: 'dest-4', type: 'destination', title: 'Dubai Luxury Weekend', subtitle: 'World\'s tallest towers, desert dunes and tax-free shopping', destination: 'Dubai', country: 'UAE', image: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&h=600&fit=crop', duration: '5 days', badge: 'Hot', tags: ['luxury', 'city'], prompt: `I want a luxury 5 day trip to Dubai UAE, flying from ${dept}. Find flights and a 5-star hotel — I want to visit the Burj Khalifa and do a desert safari.` },
    { id: 'dest-5', type: 'destination', title: 'Punta Cana All-Inclusive', subtitle: 'Palm-fringed beaches and crystal Caribbean water', destination: 'Punta Cana', country: 'Dominican Republic', image: 'https://images.unsplash.com/photo-1584553421349-3557471bed79?w=800&h=600&fit=crop', duration: '6 days', badge: 'Popular', tags: ['beach', 'resort'], prompt: `I want a 6 day all-inclusive vacation to Punta Cana Dominican Republic, flying from ${dept}. Find flights and the best beachfront resort.` },
  ];
  const events: DiscoverCard[] = [
    { id: 'evt-0', type: 'event', title: 'Coachella Valley Music & Arts Festival', subtitle: 'The world\'s most iconic music festival returns to the desert', destination: 'Palm Springs', country: 'USA', image: FALLBACK_IMAGES.festival, badge: 'Festival', tags: ['music', 'art'], prompt: `I want to attend Coachella in California this April. Flying from ${dept}. Find flights and hotels in Palm Springs or near the festival grounds.` },
    { id: 'evt-1', type: 'event', title: 'Monaco Grand Prix 2026', subtitle: 'The crown jewel of Formula 1 through the streets of Monte Carlo', destination: 'Nice', country: 'France', image: FALLBACK_IMAGES.adventure, badge: 'F1', tags: ['motorsport', 'glamour'], prompt: `I want to watch the Monaco Grand Prix in May. Flying from ${dept}. Find flights to Nice and hotels in Monaco or Nice.` },
    { id: 'evt-2', type: 'event', title: 'Tomorrowland Belgium', subtitle: 'Europe\'s most magical electronic music festival', destination: 'Brussels', country: 'Belgium', image: FALLBACK_IMAGES.concert, badge: 'Festival', tags: ['EDM', 'festival'], prompt: `I want to attend Tomorrowland in Belgium in July. Flying from ${dept}. Find flights to Brussels and hotels near the festival.` },
    { id: 'evt-3', type: 'event', title: 'Wimbledon Championships', subtitle: 'Strawberries, cream and the greatest grass court tennis', destination: 'London', country: 'United Kingdom', image: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?w=800&h=600&fit=crop', badge: 'Sports', tags: ['tennis', 'sport'], prompt: `I want to attend Wimbledon in London in July. Flying from ${dept}. Find flights and hotels near SW London.` },
  ];
  const experiences: DiscoverCard[] = [
    { id: 'exp-0', type: 'experience', title: 'Bangkok Street Food & Temples', subtitle: 'Floating markets, pad thai and golden Wats at every turn', destination: 'Bangkok', country: 'Thailand', image: 'https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&h=600&fit=crop', duration: '8 days', badge: 'Culture', tags: ['food', 'culture'], prompt: `I want to explore Bangkok Thailand for 8 days, including street food tours, temples, and a day trip to Ayutthaya. Flying from ${dept}. Find flights and a great hotel near the BTS Skytrain.` },
    { id: 'exp-1', type: 'experience', title: 'Phuket Beach & Island Hop', subtitle: 'Phi Phi, James Bond Island and powder-white beaches', destination: 'Phuket', country: 'Thailand', image: 'https://images.unsplash.com/photo-1589394815804-964ed0be2eb5?w=800&h=600&fit=crop', duration: '9 days', badge: 'Wellness', tags: ['beach', 'islands'], prompt: `I want a 9 day Phuket island-hopping trip in Thailand, flying from ${dept}. I want to visit Phi Phi Island, do a James Bond Island tour, and relax on Patong Beach. Find flights and a beachfront resort.` },
    { id: 'exp-2', type: 'experience', title: 'Cartagena & Colombian Coast', subtitle: 'Colonial walled city, crystal Caribbean and tropical islands', destination: 'Cartagena', country: 'Colombia', image: 'https://images.unsplash.com/photo-1583997052103-b4a1cb974ce5?w=800&h=600&fit=crop', duration: '6 days', badge: 'Culture', tags: ['history', 'beach'], prompt: `I want to visit Cartagena Colombia for 6 days, flying from ${dept}. I want to explore the walled city, visit the Rosario Islands, and try the local food. Find flights and a boutique hotel.` },
    { id: 'exp-3', type: 'experience', title: 'Montego Bay & Jamaican Vibes', subtitle: 'Reggae, rum, blue mountains and turquoise sea', destination: 'Montego Bay', country: 'Jamaica', image: 'https://images.unsplash.com/photo-1590523741831-ab7e8b8f9c7f?w=800&h=600&fit=crop', duration: '7 days', badge: 'Adventure', tags: ['beach', 'culture'], prompt: `I want a 7 day Jamaica vacation flying from ${dept}. I want to stay in Montego Bay, visit Dunn\'s River Falls, and experience the local food and music scene. Find flights and a great resort.` },
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
