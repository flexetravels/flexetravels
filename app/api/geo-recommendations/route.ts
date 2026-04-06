// ─── Geo-based Recommendations API ───────────────────────────────────────────
// GET /api/geo-recommendations
// Detects the user's approximate city from request IP headers (Cloudflare /
// Vercel / Railway all inject X-Forwarded-For or CF-Connecting-IP).
// Returns curated destination packages tailored to the user's origin city
// and the current season. No auth required — public endpoint, read-only.
//
// Response shape:
//   { city, country, iata, season, packages: [...], trending: [...] }

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 3600; // 1-hour CDN cache per edge region

// ─── Season helper ─────────────────────────────────────────────────────────────
function getSeason(month: number): 'winter' | 'spring' | 'summer' | 'fall' {
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'fall';
}

// ─── Origin → IATA mapping (major cities) ─────────────────────────────────────
const CITY_TO_IATA: Record<string, string> = {
  // Canada
  toronto: 'YYZ', vancouver: 'YVR', montreal: 'YUL', calgary: 'YYC',
  ottawa: 'YOW', winnipeg: 'YWG', edmonton: 'YEG',
  // USA
  'new york': 'JFK', 'los angeles': 'LAX', chicago: 'ORD', miami: 'MIA',
  dallas: 'DFW', 'san francisco': 'SFO', seattle: 'SEA', boston: 'BOS',
  atlanta: 'ATL', denver: 'DEN', houston: 'IAH', 'las vegas': 'LAS',
  phoenix: 'PHX', portland: 'PDX', orlando: 'MCO', detroit: 'DTW',
  // UK
  london: 'LHR',
  // Europe
  paris: 'CDG', amsterdam: 'AMS', frankfurt: 'FRA', madrid: 'MAD',
  rome: 'FCO', barcelona: 'BCN', zurich: 'ZRH', lisbon: 'LIS',
  // India
  mumbai: 'BOM', delhi: 'DEL', bangalore: 'BLR', chennai: 'MAA',
  kochi: 'COK', hyderabad: 'HYD', kolkata: 'CCU', pune: 'PNQ',
  // Asia
  tokyo: 'NRT', singapore: 'SIN', dubai: 'DXB', bangkok: 'BKK',
  'hong kong': 'HKG', seoul: 'ICN', sydney: 'SYD', melbourne: 'MEL',
  // Default
  unknown: 'YYZ',
};

function cityToIata(city: string): string {
  const lower = city.toLowerCase();
  for (const [key, iata] of Object.entries(CITY_TO_IATA)) {
    if (lower.includes(key)) return iata;
  }
  return 'YYZ'; // fallback to Toronto
}

// ─── Destination packages by origin + season ──────────────────────────────────
interface Package {
  id: string;
  destination: string;
  country: string;
  tag: string;
  tagColor: string;
  flightHrs: string;
  bestFor: string;
  img: string;
  teaser: string; // e.g. "from $489 flights"
  prompt: string;
}

function getPackages(originIata: string, originCity: string, season: string): Package[] {
  const city = originCity || 'your city';

  // ── Per-season curated picks ────────────────────────────────────────────────
  const seasonPacks: Record<string, Package[]> = {
    winter: [
      {
        id: 'winter_cancun',
        destination: 'Cancún', country: 'Mexico',
        tag: 'Escape the Cold', tagColor: 'bg-sky-500',
        flightHrs: '4–6h',
        bestFor: 'Beaches · Warmth · All-Inclusive',
        img: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=600&h=400&fit=crop&q=85',
        teaser: 'Beat the cold with turquoise Caribbean waters',
        prompt: `Plan a 7-day beach escape to Cancún Mexico for 2 adults flying from ${city}. I want to escape winter — warm weather, great resort with pool, and beach access. Departing in the next 4-6 weeks.`,
      },
      {
        id: 'winter_dubai',
        destination: 'Dubai', country: 'UAE',
        tag: 'Winter Sun', tagColor: 'bg-yellow-500',
        flightHrs: '13–16h',
        bestFor: 'Luxury · 25°C+ · Shopping',
        img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=600&h=400&fit=crop&q=85',
        teaser: 'Dubai in winter: 25°C, no crowds, best prices',
        prompt: `Plan a 6-day winter sun trip to Dubai UAE for 2 adults flying from ${city}. Perfect weather, luxury hotel, iconic experiences. Budget around $3500 total.`,
      },
      {
        id: 'winter_puntacana',
        destination: 'Punta Cana', country: 'Dominican Republic',
        tag: 'All-Inclusive', tagColor: 'bg-amber-500',
        flightHrs: '4–5h',
        bestFor: 'All-Inclusive · Beach · Couples',
        img: 'https://images.unsplash.com/photo-1584553421349-3557471bed79?w=600&h=400&fit=crop&q=85',
        teaser: 'All-inclusive paradise from $800/person/week',
        prompt: `Plan a 7-day all-inclusive trip to Punta Cana Dominican Republic for 2 adults flying from ${city}. Want a great beach resort, all-inclusive preferred. Next month.`,
      },
      {
        id: 'winter_bangkok',
        destination: 'Bangkok', country: 'Thailand',
        tag: 'Asia Winter', tagColor: 'bg-rose-500',
        flightHrs: '18–22h',
        bestFor: 'Culture · Street Food · Temples',
        img: 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600&h=400&fit=crop&q=85',
        teaser: "Bangkok's best season: warm, dry, vibrant",
        prompt: `Plan a 10-day cultural trip to Bangkok Thailand for 2 adults flying from ${city}. Temples, street food, floating markets, maybe a side trip to Chiang Mai.`,
      },
    ],
    spring: [
      {
        id: 'spring_lisbon',
        destination: 'Lisbon', country: 'Portugal',
        tag: 'Spring in Europe', tagColor: 'bg-indigo-500',
        flightHrs: '7–9h',
        bestFor: 'Culture · Food · Sunny Beaches',
        img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop&q=85',
        teaser: 'Spring in Lisbon: warm, blooming, fewer crowds',
        prompt: `Plan a 8-day spring trip to Lisbon Portugal for 2 adults flying from ${city}. Coastal walks, amazing food, day trips to Sintra. Mild weather, budget $4000.`,
      },
      {
        id: 'spring_tokyo',
        destination: 'Tokyo', country: 'Japan',
        tag: 'Cherry Blossom', tagColor: 'bg-pink-500',
        flightHrs: '12–16h',
        bestFor: 'Sakura · Culture · Food',
        img: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop&q=85',
        teaser: 'Cherry blossom season: Japan at its most magical',
        prompt: `Plan a 10-day cherry blossom trip to Tokyo Japan for 2 adults flying from ${city}. Sakura season, mix of temples, gardens, street food, and modern Tokyo.`,
      },
      {
        id: 'spring_bali',
        destination: 'Bali', country: 'Indonesia',
        tag: 'Wellness', tagColor: 'bg-teal-500',
        flightHrs: '20–24h',
        bestFor: 'Wellness · Rice Terraces · Surf',
        img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&h=400&fit=crop&q=85',
        teaser: 'Bali spring: dry season starts, perfect conditions',
        prompt: `Plan a 10-day wellness trip to Bali Indonesia for 2 adults from ${city}. Spa days, yoga, rice terraces in Ubud, beach time in Seminyak.`,
      },
      {
        id: 'spring_nyc',
        destination: 'New York City', country: 'United States',
        tag: 'City Break', tagColor: 'bg-violet-500',
        flightHrs: '1–2h',
        bestFor: 'Culture · Food · Central Park',
        img: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600&h=400&fit=crop&q=85',
        teaser: 'NYC in spring: Central Park, rooftop bars, perfect weather',
        prompt: `Plan a 5-day spring trip to New York City for 2 adults flying from ${city}. Central Park, great restaurants, culture, art galleries — the full NYC experience.`,
      },
    ],
    summer: [
      {
        id: 'summer_barcelona',
        destination: 'Barcelona', country: 'Spain',
        tag: 'Mediterranean Summer', tagColor: 'bg-orange-500',
        flightHrs: '8–10h',
        bestFor: 'Beach · Architecture · Nightlife',
        img: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=600&h=400&fit=crop&q=85',
        teaser: 'Barceloneta beach, Gaudí, tapas & sangria',
        prompt: `Plan a 7-day summer trip to Barcelona Spain for 2 adults flying from ${city}. Beach days, Gaudí architecture, amazing food scene, great nightlife.`,
      },
      {
        id: 'summer_bali',
        destination: 'Bali', country: 'Indonesia',
        tag: 'Dry Season', tagColor: 'bg-teal-500',
        flightHrs: '20–24h',
        bestFor: 'Surf · Temples · Sunsets',
        img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&h=400&fit=crop&q=85',
        teaser: "Bali's peak dry season: surf's up, skies clear",
        prompt: `Plan a 12-day summer escape to Bali Indonesia for 2 adults from ${city}. Mix of surfing, temple exploration, jungle waterfalls, sunset dinners.`,
      },
      {
        id: 'summer_iceland',
        destination: 'Reykjavik', country: 'Iceland',
        tag: 'Midnight Sun', tagColor: 'bg-blue-400',
        flightHrs: '6–8h',
        bestFor: 'Midnight Sun · Glaciers · Waterfalls',
        img: 'https://images.unsplash.com/photo-1476610182048-b716b8518aae?w=600&h=400&fit=crop&q=85',
        teaser: '24h daylight, waterfalls, and dramatic landscapes',
        prompt: `Plan a 7-day Iceland summer road trip for 2 adults flying from ${city}. Midnight sun, Golden Circle, glaciers, waterfalls — the full ring road experience.`,
      },
      {
        id: 'summer_santorini',
        destination: 'Santorini', country: 'Greece',
        tag: 'Romance', tagColor: 'bg-blue-600',
        flightHrs: '10–13h',
        bestFor: 'Sunsets · White Cliffs · Wine',
        img: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=600&h=400&fit=crop&q=85',
        teaser: 'Oia sunsets, caldera views, world-class wines',
        prompt: `Plan a 7-day romantic trip to Santorini Greece for 2 adults flying from ${city}. Cave hotel in Oia, caldera views, sunset wine tasting, boat tour of the island.`,
      },
    ],
    fall: [
      {
        id: 'fall_kyoto',
        destination: 'Kyoto', country: 'Japan',
        tag: 'Fall Foliage', tagColor: 'bg-orange-600',
        flightHrs: '12–16h',
        bestFor: 'Maples · Temples · Tradition',
        img: 'https://images.unsplash.com/photo-1478436127897-769e1b3f0f36?w=600&h=400&fit=crop&q=85',
        teaser: "Japan's autumn colours: a once-in-a-lifetime sight",
        prompt: `Plan a 10-day fall foliage trip to Kyoto Japan for 2 adults flying from ${city}. Arashiyama bamboo, Fushimi Inari, autumn maple viewing, traditional ryokan stay.`,
      },
      {
        id: 'fall_nyc',
        destination: 'New York City', country: 'United States',
        tag: 'Fall in NYC', tagColor: 'bg-amber-600',
        flightHrs: '1–2h',
        bestFor: 'Culture · Food · Fall Foliage',
        img: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600&h=400&fit=crop&q=85',
        teaser: 'Central Park in fall: the most beautiful city in the world',
        prompt: `Plan a 5-day fall trip to New York City for 2 adults flying from ${city}. Central Park autumn leaves, Broadway, great restaurants, art museums.`,
      },
      {
        id: 'fall_marrakech',
        destination: 'Marrakech', country: 'Morocco',
        tag: 'Culture & Spice', tagColor: 'bg-red-600',
        flightHrs: '8–12h',
        bestFor: 'Souks · Riads · Sahara',
        img: 'https://images.unsplash.com/photo-1539020140153-e479b8f22986?w=600&h=400&fit=crop&q=85',
        teaser: 'Fall in Marrakech: perfect 25°C, souks, desert trips',
        prompt: `Plan a 7-day cultural trip to Marrakech Morocco for 2 adults flying from ${city}. Medina riads, spice souks, day trip to Sahara, Majorelle Garden.`,
      },
      {
        id: 'fall_cancun',
        destination: 'Cancún', country: 'Mexico',
        tag: 'Value Season', tagColor: 'bg-sky-500',
        flightHrs: '4–6h',
        bestFor: 'Beach · Resorts · Deals',
        img: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=600&h=400&fit=crop&q=85',
        teaser: 'Fall = best Cancún prices before winter rush',
        prompt: `Plan a 7-day beach trip to Cancún Mexico for 2 adults flying from ${city}. Great value season before the winter crowds — beach resort, cenotes, Tulum day trip.`,
      },
    ],
  };

  return seasonPacks[season] ?? seasonPacks.winter;
}

// ─── Trending right now (global, not location-based) ──────────────────────────
const TRENDING = [
  { destination: 'Bali', country: 'Indonesia', tag: 'Trending', tagColor: 'bg-rose-500',
    img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=300&h=200&fit=crop&q=80' },
  { destination: 'Dubai', country: 'UAE', tag: 'Hot', tagColor: 'bg-orange-500',
    img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=300&h=200&fit=crop&q=80' },
  { destination: 'Tokyo', country: 'Japan', tag: 'Popular', tagColor: 'bg-violet-500',
    img: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=300&h=200&fit=crop&q=80' },
  { destination: 'Lisbon', country: 'Portugal', tag: 'Rising', tagColor: 'bg-teal-500',
    img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300&h=200&fit=crop&q=80' },
  { destination: 'Cancún', country: 'Mexico', tag: 'Popular', tagColor: 'bg-sky-500',
    img: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=300&h=200&fit=crop&q=80' },
];

// ─── IP extraction helper ──────────────────────────────────────────────────────
function extractIp(req: NextRequest): string | null {
  // Railway/Cloudflare injects CF-Connecting-IP; Vercel uses x-forwarded-for
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}

// ─── GET handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Allow front-end to pass ?city=Toronto for testing / manual override
  const { searchParams } = new URL(req.url);
  const overrideCity = searchParams.get('city');

  const now    = new Date();
  const month  = now.getMonth(); // 0-based
  const season = getSeason(month);

  let city    = 'Toronto';
  let country = 'Canada';

  if (overrideCity) {
    city = overrideCity;
  } else {
    const ip = extractIp(req);

    // Only call geo API if we have a non-private IP
    const isPrivate = !ip ||
      ip.startsWith('127.') || ip.startsWith('::1') ||
      ip.startsWith('10.') || ip.startsWith('192.168.') ||
      ip.startsWith('172.1') || ip.startsWith('172.2') || ip.startsWith('172.3');

    if (!isPrivate && ip) {
      try {
        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, {
          signal: AbortSignal.timeout(3_000),
          headers: { 'User-Agent': 'FlexeTravels/1.0' },
        });
        if (geoRes.ok) {
          const geo = await geoRes.json() as {
            city?: string; country_name?: string; error?: boolean;
          };
          if (!geo.error && geo.city) {
            city    = geo.city;
            country = geo.country_name ?? country;
          }
        }
      } catch {
        // Geo lookup failed — use default city (Toronto)
      }
    }
  }

  const iata     = cityToIata(city);
  const packages = getPackages(iata, city, season);

  return NextResponse.json(
    { city, country, iata, season, packages, trending: TRENDING },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Origin-City': city,
      },
    }
  );
}
