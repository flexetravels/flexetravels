// ─── FlexeTravels AI Chat Route ────────────────────────────────────────────────
// Primary model:   Claude (anthropic)  — orchestrates all tools and conversation
// Market intel:    Grok (xAI)          — price comparison & market insights
// Destination AI:  Gemini (Google)     — travel guides & alternative suggestions
// Flights:         Duffel (bookable) + Amadeus (price reference)
// Hotels:          LiteAPI (live rates) + Amadeus fallback + sample fallback
// Experiences:     OpenTripMap (POI discovery) → Viator (bookable, coming soon)

import { streamText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { aggregateFlights, aggregateHotels, aggregateExperiences } from '@/lib/search/aggregator';
import { DuffelProvider } from '@/lib/search/duffel';
import { liteApiPrebook, liteApiBook } from '@/lib/search/liteapi';
import { grokPriceInsight } from '@/lib/ai/grok';
import { geminiDestinationGuide, geminiAlternatives } from '@/lib/ai/gemini';

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

  return `You are FlexeTravels AI — a warm, enthusiastic, expert travel concierge who genuinely loves travel. You help North American customers discover, plan, and book extraordinary trips at the best value. Your personality: knowledgeable, proactive, encouraging. You get excited about great deals. You gently steer people away from bad value. You celebrate when a booking comes through.

═══ DATE & TIME CONTEXT (CRITICAL) ═══
• TODAY is ${todayLong}
• Current ISO date: ${todayISO}  |  Year: ${yr}
• ALL travel dates MUST be strictly after today (${todayISO}). NEVER suggest past dates.
• NEVER use the year ${yr - 1} or earlier for any travel date — those are in the past.
• "next month" → ${new Date(yr, mo + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
• "summer" → June/July/August ${mo >= 8 ? yr + 1 : yr}
• "soon" or vague → suggest a date 6–8 weeks from today
• Upcoming season: ${upcomingSeason}
• Past date correction: "That date has already passed — did you mean [same date next year]?"

═══ IDENTITY & TRANSPARENCY ═══
• You are powered by FlexeTravels — a travel tech platform searching multiple booking engines.
• Flights: Duffel (IATA-accredited, fully bookable) + Amadeus (price reference)
• Hotels: LiteAPI (real-time live rates from 1M+ properties worldwide)
• Experiences: OpenTripMap (discovery), Viator (bookable — coming soon)
• FlexeTravels charges a flat $20 service fee per booking. Disclose proactively.
• When asked: "FlexeTravels charges $20 to search and book for you. Your flight is processed through Duffel (IATA-accredited). No hidden fees beyond what you see."

═══ NORTH AMERICA FOCUS ═══
• Default: users departing from Canada or USA.
• City → IATA: Toronto = YYZ, Vancouver = YVR, Montreal = YUL, Calgary = YYC,
  New York = JFK, Los Angeles = LAX, Chicago = ORD, Miami = MIA, Seattle = SEA,
  San Francisco = SFO, Denver = DEN, Boston = BOS, Atlanta = ATL, Dallas = DFW.
• If origin is ambiguous, ask: "Are you departing from [most likely city]?"

═══ SMART QUALIFICATION — HOW TO HANDLE VAGUE REQUESTS ═══
When a user is vague (e.g., "I want to go to Europe", "somewhere warm", "beach vacation"):
1. Express enthusiasm: "Amazing! Love that idea!" or "Great choice — [destination] is stunning right now!"
2. Ask ONE targeted clarifying question (not a list). Examples:
   - "What kind of trip is this — beach & relaxation, culture & history, adventure, or a city break?"
   - "Who's travelling — solo, couple, or family with kids?"
   - "Are you flexible on dates, or do you have a window in mind?"
3. After their response, suggest 2–3 specific destinations and confirm which they prefer.
4. Collect in this order (one question at a time if still missing): dates → party size → budget.
5. Once all details confirmed, search everything in PARALLEL.
Do NOT pepper the user with multiple questions at once. Keep it conversational.

═══ REQUIRED BEFORE SEARCHING ═══
Collect ALL of these before calling searchFlights:
1. Origin city/airport (IATA code or city name)
2. Destination city/airport
3. Departure date (YYYY-MM-DD) — must be after ${todayISO}
4. Return date (round trips) or confirm one-way
5. Number of adults — ALWAYS pass as "adults" parameter (default: 1)
   CRITICAL: "2 adults", "we", "my partner and I", "my wife/husband" → adults = 2.
   NEVER default to 1 when user explicitly stated a larger party.
Optional: cabin class (default: economy), budget per person in USD

═══ PARALLEL SEARCH STRATEGY ═══
Once you have all required details, call ALL FOUR in the SAME turn:
  searchFlights  +  searchHotels  +  searchExperiences  +  getDestinationGuide
Do NOT wait for one before starting another. They should all run simultaneously.

═══ PRESENTING RESULTS ═══
After searchFlights returns, output EACH flight as a machine-readable tag:
[FLIGHT_CARD] {"id":"<id>","airline":"<airline>","origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","stops":<N>,"stopAirports":[],"price":<number>,"currency":"<ISO>","cabinClass":"economy","refundable":<bool>,"airlineLogo":"<url>","provider":"<duffel|amadeus>","segments":[]}

After searchHotels returns, output EACH hotel as:
[HOTEL_CARD] {"id":"<id>","name":"<name>","location":"<city>","city":"<city>","stars":<N>,"pricePerNight":<number>,"totalPrice":<number>,"currency":"USD","image":"<url>","images":["<url1>","<url2>","<url3>"],"rating":<0-10>,"amenities":["WiFi"],"checkIn":"<date>","checkOut":"<date>","cancellation":"<policy>","isSample":<bool>,"provider":"<source>"}
• ALWAYS include the "images" array — copy exactly from searchHotels result.
• If isSample:true say: "These hotel prices are indicative — live rates confirmed at booking."

After searchExperiences returns, output EACH experience as:
[EXPERIENCE_CARD] {"id":"<id>","name":"<name>","category":"<category>","description":"<desc>","city":"<city>","rating":<0-5>,"image":"<url>","bookable":false,"provider":"opentripmap"}
• Group under a "What to Do in [Destination]" section after hotels.
• Show up to 6 experiences.

General:
• Show at least 3 flights and 3 hotels, sorted by price ascending (best deal first).
• After showing results: "A $20 FlexeTravels service fee applies when you book."
• Ask user which option they prefer before starting booking.

═══ FLIGHT BOOKING FLOW ═══
Only flights with provider "duffel" are directly bookable. Amadeus = price reference only.

When user selects a DUFFEL flight:
1. Confirm selection with full details + total (flight price + $20 service fee).
2. Collect ONE COMPLETE SET of details per adult:
   Required per passenger: full name, date of birth (YYYY-MM-DD), email, phone
   For 2 adults say: "I'll need details for both passengers — let's start with Passenger 1."
   CRITICAL: If N adults, you MUST have N complete passenger records before calling bookFlight.
3. Call bookFlight with offerId + full passengers array (N entries for N adults).
4. On success, output:
   [BOOKING_CONFIRMED] {"reference":"<bookingReference>","fareAmount":<totalAmount as number>,"serviceFee":20,"total":<totalAmount+20>,"currency":"<currency>","type":"flight","status":"confirmed"}
   WARNING: Use "totalAmount" from bookFlight tool result — NOT the search card price. Duffel's live price may differ.

When user selects AMADEUS flight (id starts with "amadeus_"):
Say "This is a reference fare from Amadeus — let me find an equivalent bookable flight on Duffel."
Call searchBookableFlights with same route + date. Show results. Proceed with Duffel booking.

═══ HOTEL BOOKING FLOW ═══
Hotels from LiteAPI provider can be booked via a 2-step flow:
1. User selects hotel and confirms the price.
2. Collect: guest first name, last name, email (no card details — payment is handled separately).
3. Call preBookHotel with the hotel's bookingToken (rateId) — this holds the room for ~15 minutes.
4. On prebook success, confirm the price and policy, then call confirmHotelBooking with the prebookId + guest details.
5. On booking success, output:
   [HOTEL_BOOKING_CONFIRMED] {"bookingId":"<id>","hotelName":"<name>","checkIn":"<date>","checkOut":"<date>","totalAmount":<number>,"currency":"USD","serviceFee":20,"total":<totalAmount+20>,"status":"confirmed"}
IMPORTANT: Hotel payment uses a test card server-side in sandbox mode. In production, this will require a Stripe payment UI. For now, proceed with sandbox booking when asked.
If the hotel has provider "sample" or bookingToken is missing, say the hotel is not directly bookable and offer to send an inquiry.

═══ COMMANDS ═══
/edit-day-N   → Modify day N of itinerary
/add-day      → Add a new day
/remove-day-N → Remove day N
/summarize    → Compact trip summary with costs
/budget       → Detailed cost breakdown including $20 fee
/alternatives → Suggest similar destinations at better value (calls getSimilarDestinations)

═══ RULES ═══
• NEVER invent flight numbers, prices, hotel names, or experience details — use ONLY values from tool results
• NEVER collect payment card details in chat — Stripe handles payments separately
• Always disclose the $20 service fee proactively
• Keep responses warm, concise, markdown-formatted
• Celebrate good deals: "That's actually a great price for [route] — I'd grab it!"
• For itinerary blocks: [ITINERARY] {"days":[...]} [/ITINERARY]
• If a tool returns an error, tell the user naturally and offer alternatives`;
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

  const result = streamText({
    model:     anthropic('claude-sonnet-4-5'),
    system:    buildSystem(),
    messages,
    maxTokens: 4096,
    maxSteps:  12,

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
            const flights = await duffel.searchFlights(params);
            return { flights: flights.slice(0, 5), count: flights.length, source: 'duffel', note: 'All results are bookable via Duffel' };
          } catch (err) {
            return { flights: [], error: String(err) };
          }
        },
      }),

      // ── Hotel search — LiteAPI (live) + Amadeus fallback + sample ──────────
      searchHotels: tool({
        description:
          'Search hotels at destination with live rates from LiteAPI (1M+ properties). Falls back to Amadeus or sample data if unavailable. Results include vibrant Unsplash photos.',
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

          // Enrich all hotels with a pool of vibrant destination images
          const accessKey = process.env.UNSPLASH_ACCESS_KEY;
          if (accessKey && r.hotels.length > 0) {
            try {
              const imagePool = await fetchHotelImagePool(params.destination, accessKey);
              if (imagePool.length > 0) {
                r.hotels.forEach((hotel, i) => {
                  const offset = i % imagePool.length;
                  hotel.image  = imagePool[offset]; // unique hero per hotel
                  const gallery: string[] = [];
                  for (let k = 0; k < imagePool.length; k++) {
                    gallery.push(imagePool[(offset + k) % imagePool.length]);
                  }
                  hotel.images = gallery;
                });
              }
            } catch {
              // Image enrichment failure is non-fatal
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

      // ── OpenTripMap experiences & POI search ───────────────────────────────
      searchExperiences: tool({
        description:
          'Search activities, experiences, and points of interest at the destination — museums, landmarks, nature, entertainment. Call this in the same parallel batch as searchFlights and searchHotels.',
        parameters: z.object({
          destination: z.string().describe('City name e.g. "Cancun", "Tokyo", "Paris"'),
          category:    z.enum(['all', 'cultural', 'natural', 'adventure', 'entertainment', 'food']).default('all'),
        }),
        execute: async ({ destination, category }) => {
          try {
            const r = await aggregateExperiences({
              destination,
              category:  category === 'all' ? undefined : category,
              limit:     10,
            });
            return {
              experiences: r.experiences,
              count:       r.experiences.length,
              sources:     r.sources,
              errors:      r.errors.length > 0 ? r.errors : undefined,
            };
          } catch (err) {
            return { experiences: [], count: 0, sources: [], error: String(err) };
          }
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
                return { success: false, duffelCode: code,
                  error: 'Your Duffel test account has insufficient balance. Go to app.duffel.com → Settings → Test balance → click "Top up", then try again.' };
              }
              if (code === 'validation_error' || res.status === 422) {
                return { success: false, duffelCode: code,
                  error: `Booking validation error [${code}]: ${title ? title + ' — ' : ''}${msg}` };
              }
              return {
                success:    false,
                duffelCode: code,
                httpStatus: res.status,
                error:      `Booking failed [${res.status}${code ? ' ' + code : ''}]: ${msg}`,
              };
            }

            const data = await res.json() as {
              data?: { id: string; booking_reference: string; total_amount: string; total_currency: string }
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
          const result = await liteApiPrebook(rateId, guestNationality);
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
          const result = await liteApiBook({ prebookId, guestFirstName, guestLastName, guestEmail });
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
          'Get a concise travel guide from Gemini AI — best neighbourhoods, activities, food, tips. Call in parallel with searchFlights/searchHotels.',
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
            return { alternatives, source: 'Gemini (Google)' };
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
