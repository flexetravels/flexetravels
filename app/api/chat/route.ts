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
import { liteApiPrebook, liteApiBook } from '@/lib/search/liteapi';
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

  return `You are FlexeTravels — a passionate, detail-oriented travel concierge who genuinely loves helping families and couples plan unforgettable getaways. Think of yourself as their personal travel expert — proactive, cheerful, and always looking out for the best deal and experience.

YOUR PERSONALITY:
• You make trip planning feel effortless and exciting — like chatting with a friend who happens to know every destination.
• Be enthusiastic but not over-the-top. Sound like a real human travel expert, not a chatbot.
• When families mention kids — get excited! Recommend family-friendly resorts, pools, connecting rooms, kid-friendly activities.
• When couples mention anniversaries or honeymoons — suggest romantic upgrades, ocean views, sunset dinner spots, boutique hotels.
• Proactively flag great deals, warn about non-refundable rates, and suggest the best value options.
• Keep responses concise: 2-3 warm sentences of commentary between tool results. No walls of text.

TODAY: ${todayISO}. All dates must be after today. "next month"=${new Date(yr, mo + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. Current season: ${currentSeason}. Upcoming season starts ${upcomingSeason}.

PLATFORM: Flights via Duffel (bookable, real-time). Hotels via LiteAPI (1M+ properties, live rates). Flat $20 service fee per booking via Stripe.

IATA: YYZ=Toronto YVR=Vancouver YUL=Montreal YYC=Calgary JFK/EWR=NYC LAX=LA ORD=Chicago MIA=Miami SFO=SF DEN=Denver BOS=Boston ATL=Atlanta DFW=Dallas DXB=Dubai BCN=Barcelona NRT=Tokyo DPS=Bali CDG=Paris LHR=London FCO=Rome LIS=Lisbon PUJ=PuntaCana CUN=Cancun.

SMART QUESTIONS — ask upfront to avoid wasted searches:
• If user is vague ("somewhere warm"), offer 2-3 specific curated suggestions: "How about Cancun for beaches, Lisbon for culture, or Bali for a mix of both?"
• Always confirm: origin city, dates (or flexibility), party size, any must-haves (pool, beachfront, etc.)
• "we/couple/us/partner" → adults=2. "family" without specifics → ask about kids and ages.

SEARCH: Once you have origin, destination, dates, party size → call searchFlights AND searchHotels in the SAME turn simultaneously (parallel tool calls). Also call searchExperiences and getDestinationGuide in the SAME parallel batch. CRITICAL: all four tools MUST be called as one parallel batch — never sequentially. cabinClass always 'economy' unless user says otherwise.

CHILDREN: If kids mentioned, ask ages. Then emit before results: [CHILDREN_INFO] {"count":<N>,"ages":[...]}

═══ CRITICAL GUARDRAILS — NEVER BREAK ═══
1. NEVER fabricate flight IDs, hotel IDs, prices, booking tokens, or ANY card field.
2. ALWAYS copy ALL fields EXACTLY from tool results into card tags — zero modifications.
3. If tool returns 0 results → say so honestly, suggest alternative dates or nearby destinations.
4. If tool errors → tell user clearly and suggest retry: "Let me try that search again."
5. NEVER summarize hotels in prose — always emit individual [HOTEL_CARD] tags.
6. NEVER call tools after user selects a flight or hotel — the frontend handles booking from there.
7. Wrong IDs = failed booking. Double-check every field before emitting a card tag.

CARD FORMAT — copy ALL values EXACTLY from tool result:
[FLIGHT_CARD] {"id":"<id>","airline":"<name>","origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","stops":<N>,"stopAirports":[],"price":<n>,"currency":"<ISO>","cabinClass":"economy","refundable":<bool>,"airlineLogo":"<url>","provider":"duffel","bookingToken":"<exact token>","passengers":<n>,"segments":[],"flexibilityScore":<n>,"flexibilityLabel":"<label>","flexibilitySummary":"<text>"}
[HOTEL_CARD] {"id":"<id>","name":"<name>","location":"<city>","city":"<city>","stars":<N>,"pricePerNight":<n>,"totalPrice":<n>,"currency":"USD","image":"<url>","images":["<url>"],"rating":<n>,"amenities":[],"checkIn":"<date>","checkOut":"<date>","cancellation":"<policy>","isSample":<bool>,"provider":"liteapi","bookingToken":"<exact token>"}
Show top 3 flights price asc. Show top 3 hotels price asc — one [HOTEL_CARD] per hotel. Never show more than 3 of each.

HOTEL RULES:
• count>0 + isSample=false → emit cards as-is.
• count>0 + isSample=true → emit cards, note "indicative pricing, not bookable yet".
• count>0 + noResultsMessage set → show message as context, still emit cards.
• count=0 + noResultsMessage → quote it verbatim, no cards.
• count=0 no message → "No hotels found for those dates — want me to try nearby dates or a different area?"
• NEVER invent hotel names, prices, or tokens.

After results: 1-2 warm sentences highlighting the best options + "Just a flat $20 service fee — no hidden charges. Which catches your eye?"

STATE MACHINE:
[BROWSING] Show results. End with a warm question like "Which catches your eye?" or "Want me to look at anything else?" STOP.
[FLIGHT_CHOSEN] (triggered by [FLIGHT_SELECTED]) → ONE short excited sentence only (e.g. "Great pick! You'll be landing in Cancun by mid-morning."). Then say "Your hotel options are just above — scroll up and pick one!" STOP. Zero tools. Do NOT re-describe, re-list, or mention specific hotels by name again.
[HOTEL_CHOSEN] (triggered by [HOTEL_SELECTED]) → one warm line ("Love that choice — you're going to have an amazing stay!"), zero tools, done.
Never call tools after selection. Never collect passenger details — the checkout form handles that.

RULES: Never invent data. Be warm, concise, genuinely helpful. Make every traveler feel like a VIP.`;
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
    model:     anthropic('claude-haiku-4-5-20251001'),
    system:    buildSystem(),
    messages:  compressedMessages,
    maxTokens: 2500,
    maxSteps:  2,

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
              result_count:     r.flights.length,
              provider_sources: r.sources,
              latency_ms:       r.latencyMs,
            }).catch(() => {});
          }
          return {
            flights:   r.flights,
            count:     r.flights.length,
            sources:   r.sources,
            errors:    r.errors.length > 0 ? r.errors : undefined,
            latencyMs: r.latencyMs,
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
                segments:         [],
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
          destination: z.string().describe('City name or IATA code e.g. "Cancun" or "CUN"'),
          checkIn:     z.string().describe('Check-in date YYYY-MM-DD'),
          checkOut:    z.string().describe('Check-out date YYYY-MM-DD'),
          adults:      z.number().int().min(1).max(9).default(1),
          maxPrice:    z.number().optional().describe('Max price per night in USD'),
          stars:       z.number().int().min(1).max(5).optional().describe('Minimum star rating'),
        }),
        execute: async (params) => {
          // Hard 15 s wall-clock cap — ensures Claude can stream results promptly.
          const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 25_000));
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

      // ── Book a Duffel flight offer ─────────────────────────────────────────
      bookFlight: tool({
        description:
          'Book a confirmed DUFFEL flight after user has approved the price and provided all passenger details. DO NOT call with Amadeus offer IDs (starting with "amadeus_") — use searchBookableFlights instead.',
        parameters: z.object({
          offerId:    z.string().describe('Duffel flight offer ID from searchFlights or searchBookableFlights'),
          passengers: z.array(z.object({
            firstName:   z.string().describe('Given name exactly as on passport/ID'),
            lastName:    z.string().describe('Family name exactly as on passport/ID'),
            dateOfBirth: z.string().describe('YYYY-MM-DD'),
            email:       z.string().email().describe('Contact email'),
            phone:       z.string().describe('E.164 format e.g. +14165551234'),
          })).min(1).describe('ONE entry per adult — MUST match adults count used in searchFlights'),
        }),
        execute: async ({ offerId, passengers }) => {
          if (offerId.startsWith('amadeus_')) {
            return {
              success: false,
              error:   'This is an Amadeus price reference and cannot be booked directly. Call searchBookableFlights to find the equivalent Duffel offer.',
              action:  'call_searchBookableFlights',
            };
          }

          const token = process.env.DUFFEL_ACCESS_TOKEN;
          if (!token) return { error: 'Duffel not configured', success: false };

          const normalizePhone = (phone: string): string => {
            const digits = phone.replace(/\D/g, '');
            if (digits.length === 10) return `+1${digits}`;
            if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
            return phone.startsWith('+') ? phone : `+${digits}`;
          };

          try {
            const duffelHeaders = {
              Authorization:    `Bearer ${token}`,
              'Duffel-Version': 'v2',
              'Content-Type':   'application/json',
              Accept:           'application/json',
            };

            // Step 1: Fetch live offer to get passenger slot IDs + confirmed total
            const offerRes = await fetch(
              `https://api.duffel.com/air/offers/${offerId}`,
              { headers: duffelHeaders, signal: AbortSignal.timeout(10_000) }
            );

            if (!offerRes.ok) {
              const txt  = await offerRes.text();
              const bdy  = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
              const code = bdy?.errors?.[0]?.code ?? '';
              const msg  = bdy?.errors?.[0]?.message ?? txt.slice(0, 200);
              const gone = offerRes.status === 404 || code.includes('not_found') || code.includes('no_longer_available');
              return {
                success:    false,
                expired:    gone,
                duffelCode: code,
                error:      gone
                  ? 'This flight offer has expired. Please search for flights again to get a fresh offer.'
                  : `Could not retrieve offer — Duffel ${offerRes.status} [${code}]: ${msg}`,
              };
            }

            const offerData = await offerRes.json() as {
              data?: {
                passengers?:     Array<{ id: string; type?: string }>;
                total_amount?:   string;
                total_currency?: string;
              };
            };

            const offerPassengers = offerData.data?.passengers ?? [];
            const totalAmount     = offerData.data?.total_amount ?? '0';
            const totalCurrency   = offerData.data?.total_currency ?? 'USD';

            if (offerPassengers.length === 0) {
              return { success: false, error: 'Offer returned no passenger slots. Please search again.' };
            }
            if (passengers.length < offerPassengers.length) {
              return {
                success:          false,
                missingPassengers: offerPassengers.length - passengers.length,
                error: `This offer has ${offerPassengers.length} passenger slot(s) but you only supplied ${passengers.length}. ` +
                  `Please collect complete details (firstName, lastName, dateOfBirth, email, phone) for all ${offerPassengers.length} ` +
                  `travellers, then call bookFlight again with all ${offerPassengers.length} entries.`,
              };
            }

            // Step 2: Create the Duffel order
            const res = await fetch('https://api.duffel.com/air/orders', {
              method: 'POST',
              headers: duffelHeaders,
              body: JSON.stringify({
                data: {
                  type:            'instant',
                  selected_offers: [offerId],
                  passengers: offerPassengers.map((offerPax, i) => {
                    const p = passengers[i];
                    return {
                      id:           offerPax.id,
                      title:        'mr',
                      gender:       'm',
                      given_name:   p.firstName,
                      family_name:  p.lastName,
                      born_on:      p.dateOfBirth,
                      email:        p.email,
                      phone_number: normalizePhone(p.phone),
                    };
                  }),
                  payments: [{
                    type:     'balance',
                    amount:   totalAmount,
                    currency: totalCurrency,
                  }],
                },
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!res.ok) {
              const err     = await res.text();
              const errBody = (() => { try { return JSON.parse(err); } catch { return {}; } })();
              const code    = errBody?.errors?.[0]?.code    ?? '';
              const msg     = errBody?.errors?.[0]?.message ?? err.slice(0, 300);
              const title   = errBody?.errors?.[0]?.title   ?? '';

              if (code === 'offer_no_longer_available') {
                return { success: false, expired: true, duffelCode: code,
                  error: 'This flight offer expired during checkout. Please search for flights again — test mode offers are valid for ~15 minutes.' };
              }
              if (code === 'insufficient_balance' || msg.toLowerCase().includes('balance')) {
                const errMsg = 'Your Duffel test account has insufficient balance. Go to app.duffel.com → Settings → Test balance → click "Top up", then try again.';
                logger.flightBooking({ api: 'duffel', sessionId, offerId, success: false, httpStatus: res.status, errorCode: code, error: errMsg });
                return { success: false, duffelCode: code, error: errMsg };
              }
              if (code === 'validation_error' || res.status === 422) {
                const errMsg = `Booking validation error [${code}]: ${title ? title + ' — ' : ''}${msg}`;
                logger.flightBooking({ api: 'duffel', sessionId, offerId, success: false, httpStatus: res.status, errorCode: code, error: errMsg });
                return { success: false, duffelCode: code, error: errMsg };
              }
              const errMsg = `Booking failed [${res.status}${code ? ' ' + code : ''}]: ${msg}`;
              logger.flightBooking({ api: 'duffel', sessionId, offerId, success: false, httpStatus: res.status, errorCode: code, error: errMsg });
              return {
                success:    false,
                duffelCode: code,
                httpStatus: res.status,
                error:      errMsg,
              };
            }

            const data = await res.json() as {
              data?: { id: string; booking_reference: string; total_amount: string; total_currency: string }
            };
            logger.flightBooking({
              api: 'duffel', sessionId, offerId,
              success: true,
              bookingRef: data.data?.booking_reference,
              orderId:    data.data?.id,
              amount:     parseFloat(data.data?.total_amount ?? '0'),
              currency:   data.data?.total_currency ?? 'USD',
            });
            return {
              success:          true,
              orderId:          data.data?.id,
              bookingReference: data.data?.booking_reference,
              totalAmount:      data.data?.total_amount,
              currency:         data.data?.total_currency ?? 'USD',
              serviceFee:       { amount: 20, currency: 'USD', note: 'FlexeTravels service fee — charged separately' },
            };
          } catch (err) {
            logger.flightBooking({ api: 'duffel', sessionId, offerId, success: false, error: String(err) });
            return { error: `Booking error: ${String(err)}`, success: false };
          }
        },
      }),

      // ── Hotel pre-booking — LiteAPI (holds room for ~15 min) ──────────────
      preBookHotel: tool({
        description:
          'Hold a hotel room with LiteAPI for ~15 minutes to lock in the rate. Call this after user confirms hotel selection. Requires the bookingToken (rateId) from the searchHotels result.',
        parameters: z.object({
          rateId:           z.string().describe('The bookingToken (rateId) from the chosen hotel in searchHotels results'),
          guestNationality: z.string().length(2).default('US').describe('2-letter country code of main guest e.g. US, CA'),
        }),
        execute: async ({ rateId, guestNationality }) => {
          if (!rateId || rateId === 'undefined') {
            return { success: false, error: 'No rateId available — this hotel may be from sample data and cannot be booked directly.' };
          }
          const t0Prebook = Date.now();
          const result = await liteApiPrebook(rateId, guestNationality);
          logger.hotelPrebook({
            api: 'liteapi', sessionId,
            offerId: rateId,
            success: result.success,
            prebookId: result.prebookId,
            confirmedTotal: result.confirmedTotal,
            currency: result.currency,
            error: result.error,
            durationMs: Date.now() - t0Prebook,
          });
          return result;
        },
      }),

      // ── Hotel booking confirmation — LiteAPI ──────────────────────────────
      confirmHotelBooking: tool({
        description:
          'Finalize a hotel booking with LiteAPI after the room has been held via preBookHotel. Requires the prebookId from preBookHotel, and the main guest name + email.',
        parameters: z.object({
          prebookId:      z.string().describe('The prebookId returned by preBookHotel'),
          guestFirstName: z.string().describe('Main guest first name'),
          guestLastName:  z.string().describe('Main guest last name'),
          guestEmail:     z.string().email().describe('Main guest email address'),
        }),
        execute: async ({ prebookId, guestFirstName, guestLastName, guestEmail }) => {
          const t0Book = Date.now();
          const result = await liteApiBook({ prebookId, guestFirstName, guestLastName, guestEmail });
          logger.hotelBooking({
            api: 'liteapi', sessionId,
            prebookId,
            success:   result.success,
            bookingId: result.bookingId,
            hotelName: result.hotelName,
            amount:    result.totalAmount,
            currency:  result.currency,
            error:     result.error,
            durationMs: Date.now() - t0Book,
          });
          return result;
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
