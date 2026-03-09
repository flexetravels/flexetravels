// ─── FlexeTravels AI Chat Route ────────────────────────────────────────────────
// Primary model:  Claude (anthropic) — orchestrates all tools and conversation
// Market intel:   Grok (xAI)         — price comparison & market insights
// Destination AI: Gemini (Google)    — travel guides & alternative suggestions
// Flights:        Duffel (bookable) + Amadeus (price reference)
// Hotels:         Amadeus + sample fallback — images enriched via Unsplash API

import { streamText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { aggregateFlights, aggregateHotels } from '@/lib/search/aggregator';
import { DuffelProvider } from '@/lib/search/duffel';
import { grokPriceInsight } from '@/lib/ai/grok';
import { geminiDestinationGuide, geminiAlternatives } from '@/lib/ai/gemini';

export const maxDuration = 120;

// ─── Dynamic system prompt (generated fresh per request so date is always current) ─
function buildSystem(): string {
  const now       = new Date();
  const todayLong = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const todayISO  = now.toISOString().split('T')[0];   // YYYY-MM-DD
  const yr        = now.getFullYear();
  const mo        = now.getMonth(); // 0-based

  // Compute helpful upcoming season labels
  const seasons: Record<number, string> = { 0:'winter',1:'winter',2:'spring',3:'spring',4:'spring',5:'summer',6:'summer',7:'summer',8:'fall',9:'fall',10:'fall',11:'winter' };
  const nextSeasonMonths: Record<string, string> = {
    winter: `March ${yr}`, spring: `June ${yr}`, summer: `September ${yr}`, fall: `December ${yr}`,
  };
  const currentSeason   = seasons[mo];
  const upcomingSeason  = nextSeasonMonths[currentSeason];

  return `You are FlexeTravels AI — a warm, expert travel concierge helping North American customers plan and book the best-value trips.

═══ DATE & TIME CONTEXT (CRITICAL) ═══
• TODAY is ${todayLong}
• Current ISO date: ${todayISO}
• You are operating in the year ${yr}.
• ALL travel dates MUST be strictly after today (${todayISO}). NEVER suggest past dates.
• NEVER use the year ${yr - 1} or earlier for any travel date — those are in the past.
• When user says "next month" → use ${new Date(yr, mo + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
• When user says "summer" → use June/July/August ${mo >= 8 ? yr + 1 : yr}
• When user says "soon" or is vague → suggest a date 6–8 weeks from today as a starting point
• Upcoming season: ${upcomingSeason}
• If a user mentions a date that is already past, gently correct them: "That date has already passed — did you mean [same date next year]?"

═══ IDENTITY ═══
• You are powered by FlexeTravels, a travel technology platform. You search across multiple booking engines (Duffel, Amadeus) to find the best prices.
• FlexeTravels charges a flat $20 service fee per booking. This is separate from flight/hotel costs.
• You do NOT have an IATA or CPBC travel agent licence. You are a technology platform that facilitates bookings through licensed intermediaries.
• Be transparent: if asked, say "FlexeTravels charges $20 to search and book for you. Your flight is processed through Duffel (IATA-accredited). No hidden fees."

═══ NORTH AMERICA FOCUS ═══
• Default assumption: users are travelling from Canada or the USA.
• When a user mentions a city without an airport code, infer the closest major airport (e.g. "Toronto" → YYZ, "Vancouver" → YVR, "New York" → JFK).
• If origin is ambiguous, ask: "Are you departing from [most likely city]?"

═══ REQUIRED BEFORE SEARCHING ═══
Collect ALL of these before calling searchFlights:
1. Origin city/airport (IATA code or city name)
2. Destination city/airport
3. Departure date (YYYY-MM-DD) — must be after ${todayISO}
4. Return date (for round trips) or confirm one-way
5. Number of adults — ALWAYS pass this as the "adults" parameter to searchFlights (default: 1)
   CRITICAL: If the user says "2 adults", "we", "my partner and I", "my wife/husband", etc. → adults = 2.
   Never default to 1 when the user has explicitly stated a larger party.
Optional: cabin class (default: economy), budget in USD

═══ PARALLEL SEARCH STRATEGY ═══
Once you have required details:
• Call searchFlights AND searchHotels AND getDestinationGuide in PARALLEL (same turn)
• Do NOT wait for one before starting another
• Grok price insights are optional — call getPriceInsight after showing results if user asks "is this a good price?"

═══ PRESENTING RESULTS ═══
After searchFlights returns results, output EACH flight as:
[FLIGHT_CARD] {"id":"<id>","airline":"<airline>","origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","stops":<N>,"stopAirports":[],"price":<number>,"currency":"<ISO>","cabinClass":"economy","refundable":<bool>,"airlineLogo":"<url>","provider":"<duffel|amadeus>","segments":[]}

After searchHotels returns results, output EACH hotel as:
[HOTEL_CARD] {"id":"<id>","name":"<name>","location":"<city>","city":"<city>","stars":<N>,"pricePerNight":<number>,"totalPrice":<number>,"currency":"USD","image":"<url>","images":["<url1>","<url2>","<url3>"],"rating":<0-10>,"amenities":["WiFi"],"checkIn":"<date>","checkOut":"<date>","isSample":<bool>,"provider":"<source>"}

• ALWAYS include the "images" array in [HOTEL_CARD] output — copy it exactly from the searchHotels result.
• Show at least 3 options each (sort by price ascending — best deal first).
• If isSample:true in hotel results, say: "These hotel prices are indicative — live rates will be confirmed at booking."
• After showing options, mention: "A $20 FlexeTravels service fee applies when you book."
• Ask the user which option they prefer before starting booking.

═══ BOOKING FLOW ═══
IMPORTANT: Only flights with provider "duffel" can be booked directly. Amadeus flights are PRICE REFERENCES ONLY.

When user selects a DUFFEL flight:
1. Confirm the selection with full details and total (flight price + $20 fee)
2. Collect passenger details for EVERY adult in the party — one complete set per person:
   Required per passenger: full name, date of birth (YYYY-MM-DD), email, phone number
   Example for 2 adults: "I need details for Passenger 1 and Passenger 2 separately."
   Ask for each passenger one at a time if it's cleaner, or all at once.
   CRITICAL: If there are N adults, you MUST have N complete passenger records before proceeding.
3. Call bookFlight with offerId AND the full "passengers" array — one object per adult.
   NEVER call bookFlight with fewer passengers than the number of adults searched.
   The passengers array MUST have exactly N entries for N adults, each with firstName, lastName, dateOfBirth, email, phone.
4. On success, output [BOOKING_CONFIRMED] using ONLY the values returned by the bookFlight tool:
   [BOOKING_CONFIRMED] {"reference":"<bookingReference from tool>","fareAmount":<totalAmount from tool as number>,"serviceFee":20,"total":<totalAmount + 20>,"currency":"<currency from tool>","type":"flight","status":"confirmed"}
   WARNING: Use "totalAmount" from the bookFlight tool result for "fareAmount" — do NOT use the price shown on the flight search card. The tool returns the actual Duffel charge which may differ from the displayed search price.

When user selects an AMADEUS flight (id starts with "amadeus_"):
1. Explain: "This price is from Amadeus (a reference fare). Let me find the equivalent bookable flight on Duffel."
2. Call searchBookableFlights with the same route and date to find a Duffel offer
3. Show the Duffel results and proceed with booking from there

═══ COMMANDS ═══
/edit-day-N     → Modify day N of the itinerary
/add-day        → Add a new day
/remove-day-N   → Remove day N
/summarize      → Compact trip summary with costs
/budget         → Detailed cost breakdown including $20 fee
/alternatives   → Suggest similar destinations at better value

═══ RULES ═══
• NEVER invent flight numbers, prices, or hotel names — use ONLY values from tool results
• NEVER collect payment card details in chat — Stripe handles payments separately
• Always disclose the $20 service fee proactively
• Keep responses warm, concise, and use markdown
• For itinerary blocks, use [ITINERARY] {"days":[...]} [/ITINERARY]`;
}

// ─── Unsplash image helper ────────────────────────────────────────────────────
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

/** Fetch a pool of destination images for hotel gallery enrichment */
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

// (system prompt now generated dynamically via buildSystem() above)

// ─── Rate limiting (per session, in-memory, resets on process restart) ────────
const rateLimits = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(sessionId: string, maxPerMinute: number): boolean {
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

// ─── API Route ────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json() as {
    messages: Parameters<typeof streamText>[0]['messages'];
    sessionId?: string;
  };
  const { messages, sessionId = 'anon' } = body;

  // Rate limit: 15 req/min per session
  if (!checkRateLimit(sessionId, 15)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = streamText({
    model: anthropic('claude-sonnet-4-5'),
    system: buildSystem(),
    messages,
    maxTokens: 4096,
    maxSteps: 10,

    tools: {

      // ── Multi-source flight search (Duffel + Amadeus parallel) ─────────────
      searchFlights: tool({
        description: 'Search flights across all providers (Duffel + Amadeus) in parallel. Returns best-priced options ranked cheapest first. Duffel results are bookable; Amadeus are price references.',
        parameters: z.object({
          origin:        z.string().describe('Origin IATA airport code e.g. YVR, JFK'),
          destination:   z.string().describe('Destination IATA airport code e.g. CUN, NRT, LHR'),
          departureDate: z.string().describe('Departure date YYYY-MM-DD'),
          returnDate:    z.string().optional().describe('Return date YYYY-MM-DD for round-trips'),
          adults:        z.number().int().min(1).max(9).default(1),
          cabinClass:    z.enum(['economy','premium_economy','business','first']).default('economy'),
        }),
        execute: async (params) => {
          const r = await aggregateFlights(params);
          return {
            flights:  r.flights,
            count:    r.flights.length,
            sources:  r.sources,
            errors:   r.errors.length > 0 ? r.errors : undefined,
            latencyMs: r.latencyMs,
          };
        },
      }),

      // ── Duffel-only flight search (for booking Amadeus reference fares) ────
      searchBookableFlights: tool({
        description: 'Search ONLY Duffel for bookable flights on the same route. Use this when the user wants to book an Amadeus price reference — search Duffel for the equivalent bookable offer.',
        parameters: z.object({
          origin:        z.string().describe('Origin IATA airport code'),
          destination:   z.string().describe('Destination IATA airport code'),
          departureDate: z.string().describe('Departure date YYYY-MM-DD'),
          returnDate:    z.string().optional(),
          adults:        z.number().int().min(1).max(9).default(1),
          cabinClass:    z.enum(['economy','premium_economy','business','first']).default('economy'),
        }),
        execute: async (params) => {
          const token = process.env.DUFFEL_ACCESS_TOKEN;
          if (!token) return { flights: [], error: 'Duffel not configured' };

          try {
            const duffel = new DuffelProvider(token);
            const flights = await duffel.searchFlights(params);
            return {
              flights:  flights.slice(0, 5),
              count:    flights.length,
              source:   'duffel',
              note:     'All results are bookable via Duffel',
            };
          } catch (err) {
            return { flights: [], error: String(err) };
          }
        },
      }),

      // ── Hotel search with Unsplash image enrichment ────────────────────────
      searchHotels: tool({
        description: 'Search hotels at the destination with live property photos. Uses Amadeus live rates when configured, with vibrant destination images from Unsplash.',
        parameters: z.object({
          destination: z.string().describe('City name or IATA code e.g. "Cancun" or "CUN"'),
          checkIn:     z.string().describe('Check-in date YYYY-MM-DD'),
          checkOut:    z.string().describe('Check-out date YYYY-MM-DD'),
          adults:      z.number().int().min(1).max(9).default(1),
          maxPrice:    z.number().optional().describe('Max price per night in USD'),
          stars:       z.number().int().min(1).max(5).optional().describe('Minimum star rating'),
        }),
        execute: async (params) => {
          const r = await aggregateHotels(params);

          // Enrich all hotels with a shared pool of vibrant destination images
          const accessKey = process.env.UNSPLASH_ACCESS_KEY;
          if (accessKey && r.hotels.length > 0) {
            try {
              const imagePool = await fetchHotelImagePool(params.destination, accessKey);
              if (imagePool.length > 0) {
                r.hotels.forEach((hotel, i) => {
                  // Rotate starting offset per hotel so every card has a unique hero + gallery
                  const offset = i % imagePool.length;
                  hotel.image = imagePool[offset]; // always assign — overwrites fallback
                  // Build a rotated slice: hotel 0 → [0,1,2,3,4], hotel 1 → [1,2,3,4,0] …
                  const gallery: string[] = [];
                  for (let k = 0; k < imagePool.length; k++) {
                    gallery.push(imagePool[(offset + k) % imagePool.length]);
                  }
                  hotel.images = gallery;
                });
              }
            } catch {
              // Image enrichment failure is non-fatal — continue with existing images
            }
          }

          return {
            hotels:   r.hotels,
            count:    r.hotels.length,
            sources:  r.sources,
            isSample: r.isSample,
            errors:   r.errors.length > 0 ? r.errors : undefined,
          };
        },
      }),

      // ── Grok price intelligence ────────────────────────────────────────────
      getPriceInsight: tool({
        description: 'Ask Grok AI for market intelligence on whether a flight or hotel price is a good deal. Call this when user asks "is this good value?" or "can I get a better price?"',
        parameters: z.object({
          type:        z.enum(['flight', 'hotel']),
          origin:      z.string().optional().describe('Origin city/airport (for flights)'),
          destination: z.string().describe('Destination city'),
          dates:       z.string().describe('Travel date range e.g. "Jun 12-19, 2025"'),
          price:       z.number().describe('Price amount'),
          currency:    z.string().default('USD'),
          provider:    z.string().describe('Source e.g. "Duffel" or "Amadeus"'),
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
        description: 'Get a travel guide for the destination from Gemini AI — best areas, activities, food, tips. Call this in parallel with searchFlights/searchHotels.',
        parameters: z.object({
          destination: z.string().describe('Destination city or country'),
          travelDates: z.string().optional().describe('Approximate travel dates'),
          interests:   z.array(z.string()).optional().describe('e.g. ["food","culture","adventure"]'),
        }),
        execute: async ({ destination, travelDates, interests }) => {
          try {
            const guide = await geminiDestinationGuide(destination, travelDates, interests);
            return { guide, source: 'Gemini (Google)' };
          } catch (err) {
            return { guide: null, error: String(err) };
          }
        },
      }),

      // ── Gemini alternative destinations ───────────────────────────────────
      getSimilarDestinations: tool({
        description: 'Suggest alternative destinations with better value or easier access. Call when user uses /alternatives command or says "suggest something similar".',
        parameters: z.object({
          originalDestination: z.string(),
          budget:              z.number().describe('Total trip budget in USD'),
          interests:           z.string().describe('What the traveler enjoys'),
          departureCity:       z.string().describe('Where they are flying from'),
        }),
        execute: async (params) => {
          try {
            const alternatives = await geminiAlternatives(
              params.originalDestination,
              params.budget,
              params.interests,
              params.departureCity,
            );
            return { alternatives, source: 'Gemini (Google)' };
          } catch (err) {
            return { alternatives: null, error: String(err) };
          }
        },
      }),

      // ── Book a Duffel flight offer ─────────────────────────────────────────
      bookFlight: tool({
        description: 'Book a confirmed DUFFEL flight offer after user has explicitly approved the price and provided passenger details. DO NOT call this with Amadeus offer IDs (starting with "amadeus_") — use searchBookableFlights instead.',
        parameters: z.object({
          offerId: z.string().describe('The Duffel flight offer ID from searchFlights or searchBookableFlights results'),
          passengers: z.array(z.object({
            firstName:   z.string().describe('Given name exactly as on passport/ID'),
            lastName:    z.string().describe('Family name exactly as on passport/ID'),
            dateOfBirth: z.string().describe('YYYY-MM-DD'),
            email:       z.string().email().describe('Contact email — can be same for all passengers'),
            phone:       z.string().describe('E.164 format e.g. +14165551234'),
          })).min(1).describe('ONE entry per adult traveller — MUST match the adults count used in searchFlights'),
        }),
        execute: async ({ offerId, passengers }) => {
          // Guard: Amadeus offer IDs cannot be booked via Duffel
          if (offerId.startsWith('amadeus_')) {
            return {
              success: false,
              error: 'This is an Amadeus price reference and cannot be booked directly. Please call searchBookableFlights to find the equivalent Duffel offer, then book that instead.',
              action: 'call_searchBookableFlights',
            };
          }

          const token = process.env.DUFFEL_ACCESS_TOKEN;
          if (!token) return { error: 'Duffel not configured', success: false };

          // Normalize phone to E.164 (+1XXXXXXXXXX)
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

            // ── Step 1: Fetch the live offer to get passenger IDs + current total ──
            // Duffel orders REQUIRE each passenger to carry the `id` from the offer.
            // Without this the API returns 422 "invalid_state" or "passengers" error.
            const offerRes = await fetch(
              `https://api.duffel.com/air/offers/${offerId}`,
              { headers: duffelHeaders, signal: AbortSignal.timeout(10_000) }
            );

            if (!offerRes.ok) {
              const txt = await offerRes.text();
              console.error('[bookFlight] GET offer failed', offerRes.status, txt.slice(0, 500));
              const body = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
              const code = body?.errors?.[0]?.code ?? '';
              const msg  = body?.errors?.[0]?.message ?? txt.slice(0, 200);
              const isGone = offerRes.status === 404 || code.includes('not_found') || code.includes('no_longer_available');
              return {
                success: false,
                expired: isGone,
                duffelCode: code,
                error: isGone
                  ? 'This flight offer has expired. Please search for flights again to get a fresh offer, then book immediately.'
                  : `Could not retrieve offer — Duffel ${offerRes.status} [${code}]: ${msg}`,
              };
            }

            const offerData = await offerRes.json() as {
              data?: {
                passengers?:    Array<{ id: string; type?: string }>;
                total_amount?:  string;
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
                success: false,
                missingPassengers: offerPassengers.length - passengers.length,
                error: `This offer has ${offerPassengers.length} passenger slot(s) but you only supplied ${passengers.length}. ` +
                  `Please collect complete details (firstName, lastName, dateOfBirth, email, phone) for all ${offerPassengers.length} ` +
                  `travellers, then call bookFlight again with all ${offerPassengers.length} entries in the passengers array.`,
              };
            }

            // ── Step 2: Create the order, mapping offer passenger IDs → user details ──
            const res = await fetch('https://api.duffel.com/air/orders', {
              method: 'POST',
              headers: duffelHeaders,
              body: JSON.stringify({
                data: {
                  type:             'instant',
                  selected_offers:  [offerId],
                  // Each entry must include the `id` from the offer — this is how
                  // Duffel links user-supplied details to the priced passenger slot.
                  passengers: offerPassengers.map((offerPax, i) => {
                    const p = passengers[i];
                    return {
                      id:           offerPax.id,         // required by Duffel
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
                    amount:   totalAmount,   // must match live offer total exactly
                    currency: totalCurrency,
                  }],
                },
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!res.ok) {
              const err = await res.text();
              console.error('[bookFlight] POST order failed', res.status, err.slice(0, 800));
              const errBody = (() => { try { return JSON.parse(err); } catch { return {}; } })();
              const code    = errBody?.errors?.[0]?.code    ?? '';
              const msg     = errBody?.errors?.[0]?.message ?? err.slice(0, 300);
              const title   = errBody?.errors?.[0]?.title   ?? '';

              if (code === 'offer_no_longer_available') {
                return { success: false, expired: true, duffelCode: code,
                  error: 'This flight offer expired during checkout. Please search for flights again — test mode offers are valid for ~15 minutes.' };
              }
              if (code === 'insufficient_balance' || msg.toLowerCase().includes('balance')) {
                return { success: false, duffelCode: code,
                  error: 'Your Duffel test account has insufficient balance. Go to app.duffel.com → Settings → Test balance and click "Top up" to add test funds, then try booking again.' };
              }
              if (code === 'validation_error' || res.status === 422) {
                return { success: false, duffelCode: code,
                  error: `Booking validation error [${code}]: ${title ? title + ' — ' : ''}${msg}` };
              }

              return {
                success: false,
                duffelCode: code,
                httpStatus: res.status,
                error: `Booking failed [${res.status}${code ? ' ' + code : ''}]: ${msg}`,
              };
            }

            const data = await res.json() as {
              data?: {
                id: string;
                booking_reference: string;
                total_amount: string;
                total_currency: string;
              }
            };

            return {
              success:          true,
              orderId:          data.data?.id,
              bookingReference: data.data?.booking_reference,
              totalAmount:      data.data?.total_amount,
              currency:         data.data?.total_currency ?? 'USD',
              serviceFee:       { amount: 20, currency: 'USD', note: 'FlexeTravels service fee — charged separately' },
            };
          } catch (err) {
            return { error: `Booking error: ${String(err)}`, success: false };
          }
        },
      }),

      // ── Unsplash destination image ─────────────────────────────────────────
      getDestinationImage: tool({
        description: 'Get a beautiful, vibrant photo of a destination to enrich the conversation.',
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
