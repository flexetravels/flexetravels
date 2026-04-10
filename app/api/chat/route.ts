// ─── FlexeTravels AI Chat Route ────────────────────────────────────────────────
// Primary model:   Claude (anthropic)  — orchestrates all tools and conversation
// Market intel:    Grok (xAI)          — price comparison & market insights
// Destination AI:  Claude (Anthropic)     — travel guides & alternative suggestions
// Flights:         Duffel (bookable) + Amadeus (price reference)
// Hotels:          LiteAPI (live rates) + Amadeus fallback + sample fallback
// Experiences:     OpenTripMap (POI discovery) → Viator (bookable, coming soon)

import { streamText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// FLEXE_ANTHROPIC_KEY is used locally because Claude Code CLI shadows ANTHROPIC_API_KEY with ''
const anthropic = createAnthropic({
  apiKey: process.env.FLEXE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
});
import { z } from 'zod';
import { aggregateFlights, aggregateHotels, aggregateExperiences } from '@/lib/search/aggregator';
import { DuffelProvider } from '@/lib/search/duffel';
// liteApiPrebook / liteApiBook removed — hotel booking goes through /api/book-trip only
import { grokPriceInsight } from '@/lib/ai/grok';
import { geminiDestinationGuide, geminiAlternatives } from '@/lib/ai/gemini';
import { compressMessageHistory } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { db, DB_AVAILABLE } from '@/lib/db/client';

export const maxDuration = 120;

// ─── Dynamic system prompt ─────────────────────────────────────────────────────
// Generated fresh per request — ensures date is always accurate, never cached.
function buildSystem(): string {
  const now       = new Date();
  const todayLong = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const todayISO  = now.toISOString().split('T')[0];
  const yr        = now.getFullYear();
  const mo        = now.getMonth(); // 0-based

  const seasons: Record<number, string> = {
    0: 'winter', 1: 'winter', 2: 'spring', 3: 'spring', 4: 'spring',
    5: 'summer', 6: 'summer', 7: 'summer', 8: 'fall',   9: 'fall',
    10: 'fall',  11: 'winter',
  };
  const nextSeasonMonths: Record<string, string> = {
    winter: `March ${yr}`, spring: `June ${yr}`,
    summer: `September ${yr}`, fall: `December ${yr}`,
  };
  const currentSeason  = seasons[mo];
  const upcomingSeason = nextSeasonMonths[currentSeason];

  return `You are Maya, FlexeTravels' personal travel concierge — warm, knowledgeable, and obsessed with making every trip exceptional. You're like that well-travelled friend who knows all the hidden gems, insider tips, and how to avoid the tourist traps. Your job is to remove every friction point between the traveller and their dream trip.

YOUR PERSONALITY & APPROACH:
• Treat every customer like a VIP. They deserve your full attention and genuine care.
• Be warm and conversational — never robotic. Sound like a real human travel expert.
• Families with kids: Get excited! Suggest resorts with splash parks, kids clubs, connecting rooms, shallow pools. Warn about non-child-friendly "adults only" hotels.
• Couples / anniversaries / honeymoons: Suggest romantic touches — ocean-view rooms, sunset dinner reservations, couples spa, beachfront villas.
• Solo travellers: Safety, social atmosphere, hostels vs boutique hotels, easy solo activities.
• Business travel: Location near business district, free WiFi, express check-in, meeting facilities.
• Proactively flag: "This rate is non-refundable — want me to check for a flexible option?" or "That hotel is near the beach — great for your kids!"
• When you see a great deal, call it out enthusiastically but honestly.
• Keep each message focused: 2-3 warm sentences max between results. No walls of text.

TODAY: ${todayISO}. All dates must be after today. "next month"=${new Date(yr, mo + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. Current season: ${currentSeason}. Upcoming season starts: ${upcomingSeason}.

PLATFORM: Bookable flights via Duffel (real-time pricing). Hotels via LiteAPI (live rates). Flat $20 service fee — that's it, no hidden charges.

IATA CODES: YYZ=Toronto YVR=Vancouver YUL=Montreal YYC=Calgary JFK/EWR=NYC LAX=LA ORD=Chicago MIA=Miami SFO=SF DEN=Denver BOS=Boston ATL=Atlanta DFW=Dallas DXB=Dubai BCN=Barcelona NRT=Tokyo DPS=Bali CDG=Paris LHR=London FCO=Rome LIS=Lisbon PUJ=PuntaCana CUN=Cancun AUH=AbuDhabi SIN=Singapore BKK=Bangkok HKT=Phuket ZRH=Zurich AMS=Amsterdam.

PROACTIVE QUESTIONING — gather what you need upfront, never make the user repeat:
• Vague destination ("somewhere warm / tropical / Europe"): Offer 3 specific curated picks with one-line pitch each. "Cancún for beaches, Lisbon for culture + food, or Bali for jungle + surf vibes?"
• Always confirm before searching: origin city, exact dates OR flexibility window, number of adults, kids ages if any, any non-negotiables (beachfront? pool? budget cap? breakfast included?).
• "we/couple/us/partner/just the two of us" → adults=2. "family" without specifics → ask "How many kids and what are their ages?"
• "flexible" dates → pick the best 7-day window in the next 6-8 weeks and explain why.

ANTI-HALLUCINATION — ORIGIN AIRPORT:
• NEVER assume or guess where the user is flying FROM. If the user has not explicitly stated their departure city or airport, you MUST ask before calling any search tool. This is non-negotiable.
• Example: user says "I want to go to Cancun for a week with my kids" — you do NOT know their origin. Ask: "Sounds amazing! Where are you flying from?"
• Stating a city like "New York" means the user could be at JFK, EWR, or LGA — do NOT pick one. Use exactly what the user said as the origin label, or ask which airport they prefer.
• Never invent, assume, or default any field — origin, destination, dates, passenger counts, or cabin class — unless the user has explicitly told you.

NATURAL LANGUAGE FILTERING — translate user preferences into tool parameters:
• "under $X/night" / "max $X" / "budget" ($150) / "mid-range" ($300) → maxPrice
• "5-star" / "luxury" / "upscale" / "premium" / "high-end" → stars=5
• "4-star" / "nice hotel" / "comfortable" → stars=4
• "budget" / "cheap" / "affordable" / "backpacker" → maxPrice=100
• "boutique" / "unique" / "charming" → mention preference in commentary
• "beachfront" / "oceanfront" / "near the beach" → prefer coastal sub-cities
• "city center" / "downtown" / "walkable" → prefer central districts
• "all-inclusive" / "breakfast included" / "half board" → call out boardType in results
• "show me more" / "any other options" / "what else" / "nearby" → call searchNearbyHotels

SEARCH EXECUTION — always run in one parallel batch:
Once you have origin, destination, dates, party size → call ALL of these SIMULTANEOUSLY in ONE turn:
1. searchFlights (with correct adults + childrenAges + infants)
2. searchHotels (with correct adults + childrenAges + any filters)
3. searchExperiences
4. getDestinationGuide
CRITICAL: All four tools in a SINGLE parallel batch. Never sequential. cabinClass = 'economy' unless user specifies.

CHILDREN & INFANTS:
• Ask ages if not provided — pricing depends on it.
• Age 0-1 (under 2) = lap infant, no seat. Pass as infants= count in searchFlights. Infant fares are typically free or nominal; the search price covers adult+child seats only.
• Age 2-11 = child fare (own seat). Add to childrenAges=[age] on searchFlights AND searchHotels.
• Age 12-17 = treated as adult fare by most airlines. Add to adults count for searchFlights.
• Age 18+ = adult. Add to adults count.
• Infants cannot exceed number of adults (Duffel rule: one lap infant per accompanying adult).
• If searchFlights returns 0 results or errors: show hotels normally, tell user flights couldn't be priced for that party and they can try adjusting dates/cabin class. NEVER call searchFlights more than once per response — no retry loops.
• NEVER pass infants in childrenAges — infants travel on lap and use the infants= parameter only.

DUBAI / UAE SPECIFIC:
• Dubai has many distinct areas — always mention which district hotels are in.
• Dubai Marina → waterfront dining, JBR Beach, nightlife, modern skyline.
• Downtown Dubai → Burj Khalifa, Dubai Mall, most iconic views.
• Deira → Old Dubai, Gold/Spice Souks, more budget-friendly.
• Jumeirah → beachfront, luxury resorts, family-friendly.
• If fewer than 5 hotels found for Dubai, immediately call searchNearbyHotels with ["Dubai Marina", "Deira", "Downtown Dubai", "Jumeirah", "Abu Dhabi"].

═══ CRITICAL GUARDRAILS — NEVER BREAK ═══
1. NEVER fabricate flight IDs, hotel IDs, prices, booking tokens, or ANY card field.
2. ALWAYS copy ALL fields EXACTLY from tool results into card tags — zero modifications.
3. If tool returns 0 results → say so honestly, suggest alternative dates or nearby areas.
4. If tool errors → tell user what happened and show whatever results ARE available. NEVER call any tool more than once per response — no retry loops. One parallel batch only.
5. NEVER summarize hotels in prose only — always emit individual [HOTEL_CARD] tags for each hotel.
6. NEVER call tools after user selects a flight or hotel — frontend handles booking from there.
7. Wrong IDs = failed booking. Verify every field before emitting a card.
8. NEVER assume origin airport or city. If the user hasn't told you where they're flying FROM, ask. No default, no guess, no assumption — ever.

RESPONSE ORDER — ALWAYS follow this exact sequence:
1. ONE warm sentence (max 15 words) introducing what you found
2. ALL [FLIGHT_CARD] tags immediately — no text between them
3. ONE sentence bridging to hotels (max 10 words)
4. ALL [HOTEL_CARD] tags immediately — no text between them
5. 1-2 sentences of commentary + closing question
Cards MUST come before commentary. Never make the user wait through paragraphs of text before seeing results.

CARD FORMAT — copy ALL values EXACTLY from tool result:
[FLIGHT_CARD] {"id":"<id>","airline":"<name>","origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","stops":<N>,"stopAirports":["<IATA>"],"price":<n>,"currency":"<ISO>","cabinClass":"economy","refundable":<bool>,"airlineLogo":"<url>","provider":"duffel","bookingToken":"<exact token>","passengers":<n>,"segments":[{"origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","carrier":"<2-letter>","flightNumber":"<e.g. AC123>"}],"flexibilityScore":<n>,"flexibilityLabel":"<label>","flexibilitySummary":"<text>"}
CRITICAL: Copy the FULL segments array from the tool result exactly — each segment must include origin, destination, departure, arrival, duration, carrier, flightNumber. NEVER emit segments:[] — the user needs flight numbers and layover details.
[HOTEL_CARD] {"id":"<id>","name":"<name>","location":"<city>","city":"<city>","stars":<N>,"pricePerNight":<n>,"totalPrice":<n>,"currency":"USD","image":"<url>","images":["<url>"],"rating":<n>,"amenities":[],"checkIn":"<date>","checkOut":"<date>","cancellation":"<policy>","isSample":<bool>,"provider":"liteapi","bookingToken":"<exact token>"}

SHOWING RESULTS:
• Flights: Emit ALL [FLIGHT_CARD] tags first, then brief commentary.
• Hotels: Emit ALL [HOTEL_CARD] tags (every single one from the tool result) immediately after the bridge sentence. Never skip any.
• After all cards: "Just a flat $20 service fee — no surprises. Which catches your eye?"

SMART SEARCH BEHAVIOR:
• Region destinations (Bali, Maldives, Phuket, Goa, Santorini, Dubai, etc.) → system already searches multiple districts. Tell user: "Searching across [region] areas for the widest selection..."
• Fewer than 4 hotels returned → immediately call searchNearbyHotels. Don't wait for user to ask.
• Region → nearby city mappings: Bali→Seminyak,Ubud,Nusa Dua,Canggu | Maldives→Male,Hulhule,Maafushi | Phuket→Patong,Karon,Kata | Santorini→Fira,Oia | Goa→Panjim,Calangute,Candolim | Tulum→Playa del Carmen,Akumal | Maui→Lahaina,Kihei,Wailea | Dubai→Dubai Marina,Deira,Downtown Dubai,Jumeirah,Abu Dhabi

COMPLEX ROUTING INTELLIGENCE:
• "via the pacific" / "pacific route" → FILTER RESULTS: only show flights whose stopAirports contains at least one Pacific/Asian hub: SIN, BKK, NRT, HKG, ICN, PVG, TPE, KUL, MNL, CGK. HIDE any flight that routes via DEL, BOM, CCU, DXB, DOH, AUH, LHR, CDG, AMS, FRA, IST. Tell user: "Showing only Pacific-routed options via Asian hubs — routes via Delhi or the Middle East are excluded."
• If zero Pacific-routed flights remain after filtering → say so honestly: "No Pacific-hub routes found in current results (Duffel sandbox may not have this routing). Try a date closer to today or ask for any routing and I'll show what's available."
• "via Bangkok" / "via Japan" / "via Singapore" / "via China" → same Pacific filter. Additionally surface flights whose stopAirports contains the named city's IATA: Bangkok=BKK, Japan=NRT/KIX/HND, Singapore=SIN, China=PVG/PEK/CAN.
• "via Europe" / "via the Atlantic" → prefer flights with European hub layovers (LHR, CDG, AMS, FRA, IST). Mention: "I'll look for routes through European hubs like London or Amsterdam."
• "via the Middle East" → prefer DXB, DOH, AUH layovers. Note to user.
• "direct" / "non-stop only" → pass stopFilter hint in your response and set sort to stops in commentary so user can apply the filter themselves: "Use the Non-stop filter above to narrow to direct flights."
• Multi-city: "NYC then Paris then London" → explain you can search each leg, ask which dates per city.

COMPOUND SORTING & FILTERING:
• "fastest and cheapest" / "best value" → sort by price, tell user: "Sorted by price — you can also sort by duration using the filters above."
• "least time" / "fastest" / "quickest" → sort by duration. Mention the Duration sort button.
• "order by [X] and [Y]" → primary sort by X, note the UI lets them re-sort: "I've prioritised [X] — use the Sort control to switch to [Y]."
• "under $X for everything" / "total budget $X" → estimate split: ~45% flights, ~50% hotel, ~5% fees. Calculate max flight budget and hotel/night budget. Example: "$5000 total for 7 nights = ~$2250 flights + ~$2750 hotels ≈ $390/night max."
• "economy only" / "business class" / "premium" → pass correct cabinClass to searchFlights.
• "refundable only" → mention the Flexible badge in results and filter by refundable=true in commentary.

DESTINATION DISCOVERY (no specific city given):
When user describes criteria but no destination (e.g. "warm for kids under $5000", "beautiful beach under 10h"):
1. Immediately propose 3 specific destination picks with one-line pitch: "Here are 3 options that match perfectly:"
2. Ask user: "Which destination sounds best? I'll search real flights + hotels once you pick!"
3. Once confirmed: run parallel search for that destination.
• "warm for kids" → Cancún, Punta Cana, Bali, Phuket, Costa Rica
• "romantic / honeymoon" → Santorini, Maldives, Bora Bora, Amalfi Coast, Bali
• "cultural" → Kyoto, Lisbon, Istanbul, Marrakech, Prague
• "adventure" → Costa Rica, New Zealand, Iceland, Patagonia, Nepal
• Budget guidance: Under $2000 = short-haul (< 4h). $2000-5000 = medium (4-8h, 3-4★). $5000+ = long-haul, 4-5★ options.

COK (Kochi, India) SPECIFIC:
• COK to North America (YVR, YYZ, JFK, LAX): always Pacific route via Asian hubs (SIN, BKK, NRT, HKG, ICN). Flight time ~20-24h total.
• COK to Europe: via DXB, DOH, AUH or direct to LHR. ~10-14h.
• COK to Middle East: direct or 1-stop. ~3-5h.
• COK to Southeast Asia: direct or 1-stop. ~4-6h.

HOTEL RESULT RULES:
• count>0 + isSample=false → emit all cards.
• count>0 + isSample=true → emit cards, note "indicative pricing, confirm at checkout".
• count=0 → quote noResultsMessage if present, otherwise: "No hotels found — want me to try nearby areas or different dates?"
• NEVER invent hotel names, prices, or booking tokens.

STATE MACHINE:
[BROWSING] Show all results. End with warm question: "Which catches your eye?" or "Want me to filter by price, stars, or vibe?" STOP.
[FLIGHT_CHOSEN] (triggered by [FLIGHT_SELECTED]) → ONE short excited sentence (e.g. "Perfect choice — that gets you there in great time!"). Then: "Your hotel options are just above — scroll up and pick one to lock in your trip!" STOP. Zero tools. Do NOT re-list hotels.
[HOTEL_CHOSEN] (triggered by [HOTEL_SELECTED]) → one warm line, zero tools, done. Tell them: "Tap the 'Proceed to Checkout' button below to complete your booking — the secure form will collect your passenger details and payment there."

BOOKING HANDOFF — ABSOLUTE RULES (never break):
• NEVER ask for passenger details (name, date of birth, email, phone, passport) in this chat. The checkout form collects all of that securely.
• NEVER attempt to book a flight or hotel from within this conversation. You have no booking tools. All booking happens via the checkout UI.
• If a user types their name, DOB, email, or any personal details into chat, respond: "I can see you're ready to book! Please tap 'Proceed to Checkout' — that's where you'll enter your passenger details securely. I don't collect personal information in chat."
• If a user asks "how do I book?" or "what do I do next?" after selecting → direct them to the Checkout button. Do NOT prompt for details here.
• The offer ID and live rate are locked into the checkout card — the price shown is the price charged. No re-quoting needed.

REMEMBER: You're not just booking travel — you're helping people create memories. Every question you answer, every option you surface, every warning you give about non-refundable rates makes their trip more successful. Be the travel expert they wish they'd had all along.`;
}

// ─── Unsplash image helpers ────────────────────────────────────────────────────
async function fetchUnsplashImage(query: string, accessKey: string): Promise<string> {
  const fallbacks: Record<string, string> = {
    pool:   'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600&h=400&fit=crop',
    lobby:  'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop',
    room:   'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&h=400&fit=crop',
    resort: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop',
    hotel:  'https://images.unsplash.com/photo-1551882547-ff40c4a49a68?w=600&h=400&fit=crop',
  };
  const fallbackKey = Object.keys(fallbacks).find(k => query.toLowerCase().includes(k)) ?? 'hotel';

  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`,
      {
        headers: { Authorization: `Client-ID ${accessKey}` },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) return fallbacks[fallbackKey];
    const d = await res.json() as { urls?: { regular?: string } };
    return d.urls?.regular ?? fallbacks[fallbackKey];
  } catch {
    return fallbacks[fallbackKey];
  }
}

async function fetchHotelImagePool(destination: string, accessKey: string): Promise<string[]> {
  const queries = [
    `${destination} luxury hotel exterior architecture`,
    `${destination} resort swimming pool`,
    `${destination} hotel room interior design`,
    `${destination} beachfront resort ocean`,
    `${destination} hotel rooftop view`,
  ];
  const results = await Promise.allSettled(
    queries.map(q => fetchUnsplashImage(q, accessKey))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(Boolean);
}

// ─── Rate limiting (in-memory per session, resets on process restart) ──────────
const rateLimits = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(sessionId: string, maxPerMinute = 15): boolean {
  const now   = Date.now();
  const entry = rateLimits.get(sessionId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > 60_000) {
    rateLimits.set(sessionId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  rateLimits.set(sessionId, entry);
  return true;
}

// ─── Input sanitization ────────────────────────────────────────────────────────
function sanitizeSessionId(raw: string): string {
  // Allow alphanumeric, hyphens, underscores — strip everything else
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'anon';
}

// ─── API Route ────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  // ── Request validation ──────────────────────────────────────────────────────
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 415, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { messages: Parameters<typeof streamText>[0]['messages']; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, sessionId: rawSessionId = 'anon' } = body;
  const sessionId = sanitizeSessionId(rawSessionId);

  // Basic validation
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (messages.length > 200) {
    return new Response(JSON.stringify({ error: 'Conversation too long — please start a new chat' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 15 req/min per session
  if (!checkRateLimit(sessionId, 15)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Track anonymous user session (non-blocking)
  if (DB_AVAILABLE) {
    const uaHash = req.headers.get('user-agent')?.slice(0, 100) ?? undefined;
    db.userSessions.upsert(sessionId, uaHash).catch(() => {});
  }

  // Compress old messages to avoid re-sending large card JSON payloads.
  // Keeps the last 6 messages verbatim; replaces card JSON in older turns
  // with compact stubs — typically saves 3,000–8,000 tokens per request.
  // Cast to/from a plain record array to avoid union-type inference issues
  // with the generic compressMessageHistory — the runtime behaviour is identical.
  type AnyMsg = Record<string, unknown>;
  const compressedMessages = compressMessageHistory(
    messages as AnyMsg[],
    6,
  ) as Parameters<typeof streamText>[0]['messages'];

  const result = streamText({
    model:     anthropic('claude-sonnet-4-6'),
    system:    buildSystem(),
    messages:  compressedMessages,
    maxTokens: 5000,
    maxSteps:  3,

    tools: {

      // ── Multi-source flight search ──────────────────────────────────────────
      searchFlights: tool({
        description:
          'Search flights across Duffel + Amadeus in parallel. Returns best-priced options ranked cheapest first. Duffel results are bookable; Amadeus are price references only.',
        parameters: z.object({
          origin:        z.string().describe('Origin IATA airport code e.g. YVR, JFK'),
          destination:   z.string().describe('Destination IATA airport code e.g. CUN, NRT, LHR'),
          departureDate: z.string().describe('Departure date YYYY-MM-DD'),
          returnDate:    z.string().optional().describe('Return date YYYY-MM-DD for round-trips'),
          adults:        z.number().int().min(1).max(9).default(1),
          childrenAges:  z.array(z.number().int().min(2).max(11)).optional().describe('Ages of children 2-11 only. Each gets own seat at child fare. Do NOT include age 0-1 here — use infants= instead. Ages 12+ go in adults count.'),
          infants:       z.number().int().min(0).max(4).optional().default(0).describe('Number of lap infants under age 2. No separate seat, rides on adult lap. Must not exceed adults count.'),
          cabinClass:    z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
        }),
        execute: async (params) => {
          const r = await aggregateFlights(params);
          logger.search({
            event: 'flight_search', api: 'duffel',
            sessionId: sessionId,
            params: params as Record<string, unknown>,
            resultCount: r.flights.length,
            sources: r.sources,
            durationMs: r.latencyMs,
            errors: r.errors.length > 0 ? r.errors : undefined,
          });
          // Persist search log for growth analytics (non-blocking)
          if (DB_AVAILABLE) {
            db.searchLogs.create({
              session_id:       sessionId,
              search_type:      'flight',
              origin:           params.origin,
              destination:      params.destination,
              depart_date:      params.departureDate,
              return_date:      params.returnDate ?? null,
              adults:           params.adults,
              children:         (params.childrenAges?.length ?? 0) + (params.infants ?? 0),
              result_count:     r.flights.length,
              provider_sources: r.sources,
              latency_ms:       r.latencyMs,
            }).catch(() => {});
          }
          return {
            flights:        r.flights,
            count:          r.flights.length,
            totalAvailable: r.flights.length,
            sources:        r.sources,
            errors:         r.errors.length > 0 ? r.errors : undefined,
            latencyMs:      r.latencyMs,
          };
        },
      }),

      // ── Duffel-only flight search (for booking Amadeus reference fares) ────
      searchBookableFlights: tool({
        description:
          'Search ONLY Duffel for bookable flights on the same route. Use when user wants to book an Amadeus reference fare — find the equivalent Duffel offer first.',
        parameters: z.object({
          origin:        z.string().describe('Origin IATA airport code'),
          destination:   z.string().describe('Destination IATA airport code'),
          departureDate: z.string().describe('Departure date YYYY-MM-DD'),
          returnDate:    z.string().optional(),
          adults:        z.number().int().min(1).max(9).default(1),
          childrenAges:  z.array(z.number().int().min(2).max(11)).optional().describe('Ages of children 2-11 only. Ages 12+ go in adults.'),
          infants:       z.number().int().min(0).max(4).optional().default(0).describe('Lap infants under age 2. Must not exceed adults count.'),
          cabinClass:    z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
        }),
        execute: async (params) => {
          const token = process.env.DUFFEL_ACCESS_TOKEN;
          if (!token) return { flights: [], error: 'Duffel not configured' };
          try {
            const duffel  = new DuffelProvider(token);
            const raw     = await duffel.searchFlights(params);
            // Promote private _flex* fields → public so AI copies them into FLIGHT_CARD tags
            type Enriched = typeof raw[0] & { _flexObj?: { score: number; label: string; summary: string }; _flexScore?: number };
            const flights = raw.slice(0, 5).map((f) => {
              const e = f as Enriched;
              // Return only fields needed for [FLIGHT_CARD] — strip internal/bulk fields
              return {
                id:               e.id,
                airline:          e.airline,
                origin:           e.origin,
                destination:      e.destination,
                departure:        e.departure,
                arrival:          e.arrival,
                duration:         e.duration,
                stops:            e.stops,
                stopAirports:     e.stopAirports ?? [],
                price:            e.price,
                currency:         e.currency,
                cabinClass:       e.cabinClass,
                refundable:       e.refundable,
                airlineLogo:      e.airlineLogo,
                provider:         e.provider,
                bookingToken:     e.bookingToken,
                passengers:       e.passengers,
                segments:         (e.segments ?? []).map(s => ({
                  origin:       s.origin,
                  destination:  s.destination,
                  departure:    s.departure,
                  arrival:      s.arrival,
                  duration:     s.duration,
                  carrier:      s.carrier,
                  flightNumber: s.flightNumber,
                })),
                ...(e._flexObj ? {
                  flexibilityScore:   e._flexObj.score,
                  flexibilityLabel:   e._flexObj.label,
                  flexibilitySummary: e._flexObj.summary,
                } : {}),
              };
            });
            return { flights, count: raw.length };
          } catch (err) {
            return { flights: [], error: String(err) };
          }
        },
      }),

      // ── Hotel search — LiteAPI live rates ──────────────────────────────────
      // Images come from LiteAPI's own /data/hotel endpoint (loaded lazily in
      // the HotelCard detail panel) — no Unsplash fetching in the hot path.
      searchHotels: tool({
        description:
          'Search hotels at destination with live rates from LiteAPI (1M+ properties). Falls back to sample data if unavailable. Returns real photos, amenities, and bookable rates.',
        parameters: z.object({
          destination:  z.string().describe('City name or IATA code e.g. "Cancun" or "CUN"'),
          checkIn:      z.string().describe('Check-in date YYYY-MM-DD'),
          checkOut:     z.string().describe('Check-out date YYYY-MM-DD'),
          adults:       z.number().int().min(1).max(9).default(1),
          childrenAges: z.array(z.number().int().min(0).max(17)).optional().describe('Ages of children sharing the room'),
          maxPrice:     z.number().optional().describe('Max price per night in USD'),
          stars:        z.number().int().min(1).max(5).optional().describe('Minimum star rating'),
        }),
        execute: async (params) => {
          // Hard 12 s wall-clock cap — LiteAPI typically responds in 3-8s.
          // Reduced from 25s → 12s to improve Time To First Card significantly.
          const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 12_000));
          const search  = aggregateHotels(params);
          const r       = await Promise.race([search, timeout]);

          if (!r) {
            // Timeout — no fabricated data. Tell the AI there are no results.
            const msg = `Hotel search timed out for ${params.destination}. No hotel options available right now — please try again in a moment.`;
            logger.search({
              event: 'hotel_search', api: 'liteapi', sessionId,
              params: params as Record<string, unknown>,
              resultCount: 0, sources: [], errors: ['Hotel search timed out after 15s'],
            });
            return { hotels: [], count: 0, sources: [], isSample: false, noResultsMessage: msg };
          }

          logger.search({
            event: 'hotel_search', api: 'liteapi',
            sessionId: sessionId,
            params: params as Record<string, unknown>,
            resultCount: r.hotels.length,
            sources: r.sources,
            errors: r.errors.length > 0 ? r.errors : undefined,
          });
          // Persist search log for growth analytics (non-blocking)
          if (DB_AVAILABLE) {
            db.searchLogs.create({
              session_id:       sessionId,
              search_type:      'hotel',
              destination:      params.destination,
              depart_date:      params.checkIn,
              return_date:      params.checkOut,
              adults:           params.adults,
              result_count:     r.hotels.length,
              provider_sources: r.sources,
            }).catch(() => {});
          }

          // Return only fields needed for [HOTEL_CARD] — strip bulk LiteAPI internal data
          const hotels = r.hotels.map(h => ({
            id:           h.id,
            name:         h.name,
            location:     h.location,
            city:         h.city,
            stars:        h.stars,
            pricePerNight: h.pricePerNight,
            totalPrice:   h.totalPrice,
            currency:     h.currency,
            image:        h.image,
            images:       h.image ? [h.image] : [],
            rating:       h.rating,
            amenities:    h.amenities?.slice(0, 5) ?? [],
            checkIn:      h.checkIn,
            checkOut:     h.checkOut,
            cancellation: h.cancellation,
            isSample:     h.isSample,
            provider:     h.provider,
            bookingToken: h.bookingToken,
          }));
          return {
            hotels,
            count:            hotels.length,
            isSample:         r.isSample,
            noResultsMessage: r.noResultsMessage,
            IMPORTANT:        `You MUST emit exactly ${hotels.length} [HOTEL_CARD] tags — one per hotel in the list above. Do NOT skip, filter, or select a subset. Show every single hotel regardless of star rating. The user can filter themselves using the UI.`,
          };
        },
      }),

      // ── Multi-city nearby hotel search ─────────────────────────────────────
      searchNearbyHotels: tool({
        description:
          'Search hotels in multiple nearby cities/areas within a region. Use when user wants more options, asks "anything nearby?", "show me more", or when initial hotel results returned fewer than 3 hotels. Searches up to 4 cities in parallel and merges results.',
        parameters: z.object({
          cities:       z.array(z.string()).min(1).max(4).describe('City names to search e.g. ["Seminyak", "Ubud", "Nusa Dua"]'),
          checkIn:      z.string().describe('Check-in date YYYY-MM-DD'),
          checkOut:     z.string().describe('Check-out date YYYY-MM-DD'),
          adults:       z.number().int().min(1).max(9).default(2),
          childrenAges: z.array(z.number().int().min(0).max(17)).optional().describe('Ages of children sharing the room'),
          maxPrice:     z.number().optional().describe('Max price per night in USD'),
          stars:        z.number().int().min(1).max(5).optional().describe('Minimum star rating'),
        }),
        execute: async ({ cities, checkIn, checkOut, adults, childrenAges, maxPrice, stars }) => {
          const NEARBY_TIMEOUT_MS = 15_000;

          // Fire hotel search for each city in parallel
          const searches = cities.map(city =>
            aggregateHotels({ destination: city, checkIn, checkOut, adults, childrenAges, maxPrice, stars })
              .catch(err => {
                console.warn(`[searchNearbyHotels] Error for "${city}":`, err);
                return null;
              })
          );

          const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), NEARBY_TIMEOUT_MS));
          const results = await Promise.race([Promise.all(searches), timeout]);

          type HotelCard = {
            id: string; name: string; location: string; city: string; stars: number;
            pricePerNight: number; totalPrice: number; currency: string; image: string;
            images: string[]; rating: number; amenities: string[]; checkIn: string;
            checkOut: string; cancellation: string; isSample: boolean; provider: string; bookingToken: string;
          };
          const allHotels: HotelCard[] = [];
          const searchedCities: string[] = [];
          const allSources: string[] = [];
          let anySample = false;

          if (results) {
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              if (!r) continue;
              searchedCities.push(cities[i]);
              allSources.push(...r.sources);
              if (r.isSample) anySample = true;
              for (const h of r.hotels) {
                allHotels.push({
                  id:           h.id,
                  name:         h.name,
                  location:     h.location ?? '',
                  city:         h.city ?? '',
                  stars:        h.stars,
                  pricePerNight: h.pricePerNight,
                  totalPrice:   h.totalPrice,
                  currency:     h.currency ?? 'USD',
                  image:        h.image ?? '',
                  images:       h.image ? [h.image] : [],
                  rating:       h.rating ?? 0,
                  amenities:    h.amenities?.slice(0, 5) ?? [],
                  checkIn:      h.checkIn ?? '',
                  checkOut:     h.checkOut ?? '',
                  cancellation: h.cancellation ?? '',
                  isSample:     h.isSample ?? false,
                  provider:     h.provider ?? 'liteapi',
                  bookingToken: h.bookingToken ?? '',
                });
              }
            }
          }

          // Deduplicate by hotel name (lowercase)
          const seen = new Set<string>();
          const hotels = allHotels.filter(h => {
            const key = h.name.toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).sort((a, b) => a.pricePerNight - b.pricePerNight).slice(0, 20);

          logger.search({
            event: 'hotel_search', api: 'liteapi',
            sessionId: sessionId,
            params: { cities, checkIn, checkOut, adults, maxPrice, stars } as Record<string, unknown>,
            resultCount: hotels.length,
            sources: [...new Set(allSources)],
          });

          return {
            hotels,
            count:           hotels.length,
            cities_searched: searchedCities,
            isSample:        anySample,
            sources:         [...new Set(allSources)],
            IMPORTANT:       `You MUST emit exactly ${hotels.length} [HOTEL_CARD] tags — one per hotel. Do NOT skip any.`,
          };
        },
      }),

      // ── Foursquare experiences & POI search ────────────────────────────────
      searchExperiences: tool({
        description:
          'Search for top things to do, attractions, restaurants, and experiences at the destination using Foursquare. Call in parallel with searchFlights/searchHotels.',
        parameters: z.object({
          destination: z.string().describe('City name e.g. "Cancun", "Tokyo", "Bali"'),
          category:    z.string().optional().describe('cultural | natural | adventure | entertainment'),
          limit:       z.number().optional().describe('Max results, default 6'),
        }),
        execute: async ({ destination, category, limit }) => {
          const r = await aggregateExperiences({ destination, category, limit: limit ?? 6 });
          return {
            experiences: r.experiences,
            count:        r.experiences.length,
            sources:      r.sources,
          };
        },
      }),

      // ── Grok price intelligence ────────────────────────────────────────────
      getPriceInsight: tool({
        description:
          'Ask Grok AI for market intelligence on whether a price is a good deal. Call when user asks "is this good value?" or "can I get cheaper?"',
        parameters: z.object({
          type:        z.enum(['flight', 'hotel']),
          origin:      z.string().optional().describe('Origin city/airport (flights only)'),
          destination: z.string().describe('Destination city'),
          dates:       z.string().describe('Travel date range e.g. "Jun 12–19, 2026"'),
          price:       z.number().describe('Price amount'),
          currency:    z.string().default('USD'),
          provider:    z.string().describe('Source e.g. "Duffel", "LiteAPI"'),
        }),
        execute: async (params) => {
          try {
            const insight = await grokPriceInsight(params);
            return { insight, source: 'Grok (xAI)' };
          } catch (err) {
            return { error: String(err), insight: null };
          }
        },
      }),

      // ── Gemini destination guide ───────────────────────────────────────────
      getDestinationGuide: tool({
        description:
          'Get a concise travel guide from Claude AI — best neighbourhoods, activities, food, tips. Call in parallel with searchFlights/searchHotels.',
        parameters: z.object({
          destination: z.string().describe('Destination city or country'),
          travelDates: z.string().optional().describe('Approximate travel dates'),
          interests:   z.array(z.string()).optional().describe('e.g. ["food","culture","adventure"]'),
        }),
        execute: async ({ destination, travelDates, interests }) => {
          try {
            // Hard 12s cap — destination guide is secondary to flights/hotels
            const guide = await Promise.race([
              geminiDestinationGuide(destination, travelDates, interests),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('guide_timeout')), 12_000)),
            ]);
            return { guide, source: 'Claude (Anthropic)' };
          } catch (err) {
            return { guide: null, error: String(err) };
          }
        },
      }),

      // ── Gemini alternative destinations ───────────────────────────────────
      getSimilarDestinations: tool({
        description:
          'Suggest alternative destinations with better value or easier access from North America. Call on /alternatives command or "suggest something similar".',
        parameters: z.object({
          originalDestination: z.string(),
          budget:              z.number().describe('Total trip budget in USD'),
          interests:           z.string().describe('What the traveler enjoys'),
          departureCity:       z.string().describe('Where they are flying from'),
        }),
        execute: async (params) => {
          try {
            const alternatives = await geminiAlternatives(
              params.originalDestination, params.budget, params.interests, params.departureCity,
            );
            return { alternatives, source: 'Claude (Anthropic)' };
          } catch (err) {
            return { alternatives: null, error: String(err) };
          }
        },
      }),

      // ── Unsplash destination image ─────────────────────────────────────────
      getDestinationImage: tool({
        description: 'Get a beautiful photo of a destination to enrich the conversation.',
        parameters: z.object({
          query: z.string().describe('e.g. "Cancun beach sunset turquoise water"'),
        }),
        execute: async ({ query }) => {
          const key = process.env.UNSPLASH_ACCESS_KEY;
          if (!key) return { url: 'https://images.unsplash.com/photo-1540202404-1b927e27fa8b?w=800&h=500&fit=crop' };
          const url = await fetchUnsplashImage(query, key);
          return { url };
        },
      }),
    },

    toolChoice: 'auto',
  });

  return result.toDataStreamResponse();
}
