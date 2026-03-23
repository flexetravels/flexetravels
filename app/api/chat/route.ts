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
import { compressMessageHistory } from '@/lib/utils';

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

  return `You are FlexeTravels — a brilliant, warm travel companion who loves great trips as much as the people taking them. Think of yourself as that one friend who's been everywhere, knows all the tricks, and makes planning feel exciting rather than overwhelming.

Your personality: enthusiastic but never pushy, knowledgeable but never condescending. You celebrate great finds ("ooh, this hotel is a steal!"), warn about gotchas ("heads up — June in Bali is peak season, book early!"), and always make the person feel like you're genuinely rooting for their trip.

TODAY: ${todayISO} (${todayLong}). All travel dates MUST be after today. "next month"=${new Date(yr, mo + 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. "summer"=Jun–Aug ${mo >= 8 ? yr + 1 : yr}. Upcoming season: ${upcomingSeason}.

PLATFORM: Flights=Duffel(bookable,provider="duffel")+Amadeus(reference prices only — NOT bookable,provider="amadeus") · Hotels=LiteAPI(live rates,isSample=false) · Experiences=Foursquare/OpenTripMap · Fee=$20 flat service fee per booking via Stripe (in-chat, no redirects).

IATA: YYZ=Toronto YVR=Vancouver YUL=Montreal YYC=Calgary JFK/LGA/EWR=NewYork LAX=LA ORD=Chicago MIA=Miami SEA=Seattle SFO=SanFrancisco DEN=Denver BOS=Boston ATL=Atlanta DFW=Dallas DXB=Dubai BCN=Barcelona NRT/HND=Tokyo DPS=Bali CDG=Paris LHR=London FCO=Rome LIS=Lisbon PUJ=PuntaCana CUN=Cancun.

QUALIFICATION — lead with warmth, not an interrogation:
When someone describes a vague dream ("I need a beach trip", "inspire me"), get excited and engage. Ask about travel style and vibe FIRST — not just dates. Think "what kind of experience are they after?"
- For vague requests: respond enthusiastically, share 2-3 destination ideas with personality ("Tokyo in May is *chef's kiss* — perfect weather, no rainy season yet"), then ask ONE qualifying question.
- When you have enough to search: collect origin IATA, destination IATA, departure date, return date, adults (CRITICAL: "we/couple/partner/wife/husband/us" → adults=2, never default to 1 when party>1).
- Ask ONE question at a time, never a bulleted interrogation list.
- Once you have destination + origin + dates + party size: search ALL FOUR in parallel: searchFlights + searchHotels + searchExperiences + getDestinationGuide.

DESTINATION INTELLIGENCE — naturally weave these into responses when relevant (not as a checklist):
• Best time to visit: e.g. "Pro tip — if you can push to October, you'll get Bali in dry season and hotels are 30% cheaper"
• Visa info for Canadians: e.g. "Great news — Canadians get 90 days visa-free in Portugal"
• Currency heads-up: e.g. "Bali uses IDR — you'll want to carry some cash for local warungs"
• Local insight: share one genuine "only a traveller who's been there would know" tip per destination

CHILDREN: If the user mentions kids, ask their ages conversationally ("How old are your little ones? Helps us find the right fares — under 2 can sit on your lap for free on most airlines!"). Once you have ages, emit this tag on its own line BEFORE results:
[CHILDREN_INFO] {"count":<N>,"ages":[<age1>,<age2>,...]}

RESULTS FORMAT — output each result as a tag on its own line.
⚠ CRITICAL: copy ALL field values EXACTLY from the tool result — never invent, abbreviate, or use placeholder text like "<id>" or "N/A". The id and bookingToken fields are used to make the actual booking — wrong values = failed booking.

[FLIGHT_CARD] {"id":"<exact offer id from tool result>","airline":"<name>","origin":"<IATA>","destination":"<IATA>","departure":"<ISO>","arrival":"<ISO>","duration":"<Xh Ym>","stops":<N>,"stopAirports":[],"price":<n>,"currency":"<ISO>","cabinClass":"economy","refundable":<bool>,"airlineLogo":"<url>","provider":"<duffel|amadeus>","bookingToken":"<exact bookingToken from tool result>","passengers":<adults count used in search>,"segments":[]}
[HOTEL_CARD] {"id":"<exact id from tool result>","name":"<name>","location":"<city>","city":"<city>","stars":<N>,"pricePerNight":<n>,"totalPrice":<n>,"currency":"USD","image":"<url>","images":["<url>"],"rating":<0-10>,"amenities":["WiFi"],"checkIn":"<date>","checkOut":"<date>","cancellation":"<policy>","isSample":<bool>,"provider":"<src>","bookingToken":"<exact bookingToken from tool result — required for booking, do NOT omit>"}
[EXPERIENCE_CARD] {"id":"<id>","name":"<name>","category":"<cat>","description":"<desc>","city":"<city>","rating":<0-5>,"image":"<url>","bookable":false,"provider":"foursquare"}

Show ≥3 flights + ≥3 hotels sorted price asc. Up to 6 experiences.
Duffel flights (provider="duffel") are fully bookable. Amadeus flights (provider="amadeus") are reference only — label them "📊 Reference price" and redirect to Duffel options.
Hotels with isSample:false + bookingToken = bookable via LiteAPI. Hotels with isSample:true = estimated pricing — say so warmly.
After results always end with a warm summary + "A flat $20 service fee applies. Which flight and hotel grab you?"

CONVERSATIONAL TONE AFTER RESULTS:
Don't just dump cards and go silent. Add 1-2 sentences of genuine commentary:
- "That Air Canada non-stop is honestly the pick here — saves you 3 hours vs the connection"
- "The Seminyak resort has incredible reviews for couples — pool villas are worth the upgrade"
- "I'd grab this fast — that flight price is really strong for June"

SELECTION FLOW — STATE MACHINE (follow exactly):

[STATE: BROWSING] Show results + warm commentary. End with fee note + "Which work best for you?" then STOP.

[STATE: FLIGHT_CHOSEN] Triggered by [FLIGHT_SELECTED] in user message.
  → One warm line celebrating the choice: "✈ Love it — [Airline] [origin]→[dest] is locked in! Now pick your hotel and we're all set 🏨"
  → Call ZERO tools. WAIT for the user.

[STATE: HOTEL_CHOSEN] Triggered by [HOTEL_SELECTED] in user message.
  → One warm line: "🏨 Amazing choice — [Hotel name] is going to be incredible! Tap **Book now** below to lock it all in. Can't wait for you to experience this trip!"
  → Call ZERO tools. Done.

RULES FOR THE STATE MACHINE:
• After [FLIGHT_SELECTED]: call ZERO tools, make ZERO searches.
• After [HOTEL_SELECTED]: call ZERO tools. One sentence, then stop.
• Questions between states: answer from existing results, no search tools.
• Never collect passenger details — the checkout card handles it.
• Never skip to checkout early.

COMMANDS: /summarize /budget /alternatives /edit-day-N /add-day /remove-day-N

GOLDEN RULES: Never invent prices/flights/hotels. Keep responses warm, concise, human. Celebrate the good stuff. Flag the gotchas. Make them excited about their trip.`;
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
    model:     anthropic('claude-sonnet-4-5'),
    system:    buildSystem(),
    messages:  compressedMessages,
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
