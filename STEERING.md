# FlexeTravels — Steering Document
> Last updated: 2026-04-19 | Environment: Staging | Status: **v1.4 — Dynamic system prompt, fare brand display, baggage per variant, penalty currency clarity**

---

## 1. Project Overview

**FlexeTravels** is an AI-powered travel booking platform targeting North American customers. It provides end-to-end flight and hotel discovery via a conversational AI chatbot, plus a dynamic discovery landing page — aggregating prices across multiple booking engines and charging a flat **$20 service fee** per transaction.

| Item | Value |
|---|---|
| Owner | Suman (support@flexetravels.com) |
| Brand | FlexeTravels |
| Target Market | North America (Canada + USA) |
| Business Model | $20 flat service fee per booking (CAD for CA customers, USD for US customers) |
| IATA / CPBC Licence | **None** — platform is a tech aggregator, not a licensed travel agent |
| Tech Stack | Next.js 15, React 19, TypeScript, TailwindCSS |
| AI Models | Claude Sonnet (primary), Gemini 2.0 Flash (destination guides + discover), Grok 3 Fast (price intel — dormant) |
| Flight Booking | Duffel API — live, IATA-accredited, test mode |
| Flight Reference | Amadeus Self-Service API — price comparison only, NOT bookable |
| Hotels | LiteAPI v3.0 (primary, bookable) → Amadeus (fallback) → sample data (last resort) |
| Experiences | Foursquare API (discovery photos), Viator (pending approval — bookable experiences) |
| Images | Unsplash API (`api.unsplash.com`, never deprecated `source.unsplash.com`) |
| Payment | Stripe embedded PaymentElement (no redirect) — $20 CAD (CA) / $20 USD (US), test mode |
| Backend | All logic in Next.js API routes (no Railway, no separate backend) |
| Repo Path | `/flexetravels-next` (Next.js 15 App Router) |
| Git Checkpoints | `v1.0-stable` (2026-03-08), `v1.2` (6237bd7, 2026-03-14), `v1.4-stable` (3531b79, 2026-04-19) |

---

## 2. Page Structure

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | **Discovery landing page** — trending destinations, events, experiences |
| `/chat` | `app/chat/page.tsx` | **AI chat interface** — flight/hotel search + booking |
| `/booking` | `app/booking/page.tsx` | Post-booking confirmation page |

### Landing → Chat flow
1. Landing page fetches `/api/discover` (Gemini-powered, daily cached)
2. User clicks a destination/event/experience card
3. Prompt stored in `sessionStorage` key `ft_auto_prompt`
4. `router.push('/chat')` navigates to chat
5. Chat page reads and removes `ft_auto_prompt` in `useState` initializer (runs once — React Strict Mode safe)
6. `useEffect` fires `append()` with the decoded prompt → chatbot starts searching immediately

**Why `useState` initializer (not `useEffect`) for sessionStorage read:**
React 18 Strict Mode double-invokes effects in development. Using a `useEffect` with `[]` to read storage causes the item to be removed on the first invocation and the timer cancelled by cleanup — so the second invocation finds nothing. `useState(() => ...)` initializers run exactly once and are not double-invoked.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  FlexeTravels Frontend (Next.js 15 App Router)                    │
│                                                                    │
│  app/page.tsx                   ← Discovery landing page          │
│  app/chat/page.tsx              ← Main chat UI                    │
│  app/api/chat/route.ts          ← Claude orchestrator + tools     │
│  app/api/discover/route.ts      ← Gemini-powered trending cards   │
│  app/api/book/route.ts          ← Booking validation              │
│  app/api/stripe/create-payment-intent/route.ts  ← $20 Stripe fee │
│  app/api/debug/liteapi/route.ts ← LiteAPI debug (remove pre-live) │
│  app/booking/page.tsx           ← Post-booking confirmation page  │
└───────────────────────┬──────────────────────────────────────────┘
                        │ tool calls
        ┌───────────────┼──────────────────┬──────────────┐
        ▼               ▼                  ▼              ▼
   Duffel API      LiteAPI v3.0       Unsplash API    Gemini API
 (bookable flights) (bookable hotels)  (hotel/dest   (destination
                        │               images)        guides +
                   Amadeus API                         discover)
                 (hotel fallback +
                  price reference)
        │               │
        └───────────────┘
          Aggregated by lib/search/aggregator.ts
          Ranked by price ASC, deduplicated
```

### 3.1 AI Orchestration

| Model | Role | API |
|---|---|---|
| Claude Sonnet | Primary orchestrator — conversation, tool calls, booking | `@ai-sdk/anthropic` (Vercel AI SDK) |
| Gemini 2.0 Flash | Destination guides, alternative suggestions, discover cards | Direct REST (`generativelanguage.googleapis.com`) |
| Grok 3 Fast | Price market intelligence | Direct REST (`api.x.ai`, OpenAI-compatible) |

**No npm SDK installs for Gemini/Grok/Stripe** — all implemented as raw `fetch()` REST calls.

### 3.1.1 v1.4 Dynamic System Prompt Architecture

The system prompt is now fully dynamic with 6 composable sections — no hardcoded regex gates:

1. **Safety Rules** — input sanitization, honeypot detection, rate limiting
2. **Persona** — Maya, friendly travel advisor with personality + routing intelligence (Dubai/UAE, COK/Kochi context always available)
3. **Search Rules** — intent-driven tool strategy with few-shot examples, `maxConnections` for non-stop filtering
4. **Routing Rules** — destination knowledge, super-human complex vacation planning
5. **State Machine** — flight/hotel selection tracking, booking flow orchestration
6. **Security Rules** — price tampering prevention, token validation

Key design decisions:
- **Intent-driven tool calling** — Maya decides which tools to invoke based on user intent, not forced parallel batch
- **`maxConnections` parameter** — `0` = non-stop only, `1` = max 1 stop, `undefined` = no limit. Passed per-slice to Duffel API
- **Tool summary includes return leg stops** — prevents Maya from hallucinating "all non-stop" when only outbound is non-stop

### 3.1.2 Fare Variant System

Each physical flight can have up to 3 fare variants (cheapest, most flexible, mid-tier). Grouped by flight identity (same flight numbers + departure time) in `groupIntoFareVariants()`.

**Fare labeling priority:**
1. Airline's own fare brand name from Duffel (`fare_brand_name` on slice) — e.g. "Economy Light", "Economy Classic"
2. Condition-based labels (Flex/Standard/Basic from refundable+changeable flags)
3. Neutral price-tier labels (Value/Plus/Premium) when all conditions are identical

**Per-variant data displayed:**
- Price and currency
- Checked bag count (from `segments[].passengers[].baggages`)
- Flexibility summary with penalty amounts in the airline's native currency
- When penalty currency differs from ticket currency (e.g. EUR penalties on USD ticket for Lufthansa), a note: "fees in EUR per airline policy"

**Flexibility scoring** (`lib/scoring/flexibility.ts`):
- Refundability weight: 60%, Changeability weight: 40%
- Penalty ratio reduces score (penalty ≥ 50% of fare → 0.2 score)
- Labels: Flexible (0.65–1.00), Moderate (0.35–0.64), Locked (0.00–0.34)

### 3.2 Flight Booking Architecture (Critical)

```
Duffel  = BOOKABLE  — use for all real orders
Amadeus = REFERENCE — price comparison display only

Booking flow:
1. searchFlights() → returns both Duffel (off_xxx) + Amadeus (amadeus_xxx) offers
2. User selects flight
   - If Duffel: call bookFlight(offerId) directly
   - If Amadeus: call searchBookableFlights() first (Duffel-only), then book result
3. bookFlight():
   a. GET /air/offers/:id → extract passenger IDs (pas_xxx) + live total_amount
   b. POST /air/orders with passenger IDs mapped to user details
   c. payment type=balance, amount=offer.total_amount (NOT hardcoded "0")
4. Return booking_reference → display [BOOKING_CONFIRMED] card
```

### 3.3 Multi-Passenger Booking (Critical)

- The `adults` count from the user **must always be passed** to `searchFlights`. Forgetting it defaults to 1 adult, making the Duffel offer have only 1 passenger slot.
- Before calling `bookFlight`, collect **one complete passenger record per adult**: `firstName`, `lastName`, `dateOfBirth`, `email`, `phone`.
- The `passengers` array in `bookFlight` must have exactly N entries for N adults.
- If the AI supplies fewer passengers than offer slots, the tool returns a descriptive error with the exact count needed.

### 3.4 Hotel Booking Architecture — LiteAPI v3.0

```
Hotel search flow:
1. searchHotels() → LiteAPI /data/hotels (GET) → hotel list for city/country
2. LiteAPI /hotels/rates (POST) → live rates for those hotel IDs
   - Fields: checkin, checkout (NOT checkinDate/checkoutDate — v3 breaking change)
   - occupancies: [{ adults: N, children: [] }]
3. Pick cheapest rate per hotel → return NormalizedHotel[] with bookingToken = rateId
4. User selects hotel → AI calls prebookHotel(rateId)
5. LiteAPI /rates/prebook → returns prebookId
6. AI calls bookHotel(prebookId, guestInfo) → LiteAPI /rates/book
7. Display [HOTEL_BOOKING_CONFIRMED] card

Fallback chain: LiteAPI → Amadeus hotels → sample data (isSample: true)
Sample data = non-bookable indicative prices only
```

**Critical LiteAPI field names (v3.0 API):**
- ✅ `checkin` / `checkout`
- ❌ `checkinDate` / `checkoutDate` (causes HTTP 400, error code 4002)

### 3.5 New Booking Flow — Select First, Pay Once

The chat AI now follows a **select-all-first** pattern before collecting passenger details or charging:

```
1. User describes trip intent
2. AI presents flight options → user selects one
3. AI presents hotel options → user selects one (optional)
4. AI presents experiences → user picks (optional)
5. AI collects passenger/guest details ONCE for all bookings
6. AI books flight (Duffel) + hotel (LiteAPI) in sequence
7. Single [PAYMENT_REQUIRED] card emitted after both confirmations
8. Stripe $20 service fee charged via embedded PaymentElement
```

### 3.6 Stripe Embedded Payment

```
No redirect — payment happens in-chat via PaymentElement

Flow:
1. [BOOKING_CONFIRMED] + [HOTEL_BOOKING_CONFIRMED] both emitted
2. [PAYMENT_REQUIRED] {"bookingReference":"...","bookingType":"combined","amount":2000,"currency":"cad"|"usd"} emitted
3. ChatMessage renders <StripePaymentForm> after confirmations
4. StripePaymentForm:
   - Loads stripe.js from CDN (https://js.stripe.com/v3/) — no npm package
   - POST /api/stripe/create-payment-intent → clientSecret
   - Mounts PaymentElement in teal brand theme
   - confirmPayment with redirect:'if_required'
5. States: idle → loading → ready → submitting → success | error
```

**Currency detection (in AI system prompt):**
- Origin airport starts with `Y` (Canadian IATA) → `currency: "cad"`
- All others → `currency: "usd"`
- Amount always `2000` cents ($20)

### 3.7 Token Compression (Rate Limit Fix)

`compressMessageHistory()` in `lib/utils.ts` prevents Anthropic 429 (30k tokens/min) errors:
- Replaces `[*_CARD] {...JSON...}` in messages older than last 6 with `[*_CARD_SHOWN]` stubs
- Saves 3,000–8,000 tokens per request
- Applied in `app/api/chat/route.ts` before every `streamText()` call
- System prompt also shortened ~40% to reduce base token cost

### 3.8 Streaming UI — No Flicker

`ChatMessage.tsx` fully separates streaming vs. complete rendering:
- `streaming=true` (isLast && isLoading): render ONLY tool status pills + `ComposingBlock` animated indicator
- `streaming=false`: render full content with `animate-fade-in-up` transition
- No skeleton loaders during streaming — eliminates card pop-in flicker
- `ComposingBlock`: animated teal dots + contextual text ("Searching..." / "Composing your results...")

### 3.9 `/api/discover` — Daily Trending Cards

- Detects user region from Vercel `x-vercel-ip-country` / Cloudflare `cf-ipcountry` headers
- Calls **Gemini 2.0 Flash** with a structured prompt requesting 6 destinations, 4 events, 4 experiences as JSON
- Fetches **Unsplash images** for each card in parallel
- Results cached **in-memory per date+region key** (`YYYY-MM-DD:CC`) — Gemini called once per day
- Falls back to curated static data if Gemini is unavailable or returns malformed JSON

---

## 4. Legal & Compliance (No IATA/CPBC)

Since FlexeTravels operates **without IATA or CPBC accreditation**:

1. **Technology Platform Disclosure** — all pages and chat responses state:
   > *"FlexeTravels is a travel technology platform, not a licensed travel agent. Flight bookings are processed through Duffel (IATA-accredited). FlexeTravels charges a $20 service fee for search aggregation and booking facilitation."*

2. **Payment Split**:
   - Duffel charges flight cost directly (via `balance` payment in test mode)
   - LiteAPI charges hotel cost directly
   - FlexeTravels charges $20 service fee separately via Stripe
   - FlexeTravels never holds flight/hotel funds

3. **$20 Fee Policy**: Non-refundable once booking is confirmed. Refundable if booking fails.

---

## 5. Search Provider Abstraction

All booking sources implement `SearchProvider` from `lib/search/types.ts`:

```typescript
interface SearchProvider {
  name: string;
  searchFlights(params: FlightSearchParams): Promise<NormalizedFlight[]>;
  searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]>;
}
```

| Provider | File | Flights | Hotels | Bookable |
|---|---|---|---|---|
| DuffelProvider | `lib/search/duffel.ts` | ✅ Live (test token) | ❌ | ✅ Yes |
| LiteApiProvider | `lib/search/liteapi.ts` | ❌ | ✅ Live (v3.0) | ✅ Yes |
| AmadeusProvider | `lib/search/amadeus.ts` | ✅ Live (free tier) | ✅ Fallback | ❌ Reference only |
| Sample fallback | `lib/search/aggregator.ts` | ❌ | ✅ Indicative prices | ❌ |

---

## 6. Image Strategy

**Rule: Never use `source.unsplash.com` — it is deprecated and returns broken "?" images.**

| Context | Method |
|---|---|
| Hotel cards (sample/fallback hero) | `images.unsplash.com/photo-{id}?w=600&h=400&fit=crop` — hardcoded CDN URLs |
| Hotel gallery enrichment | `api.unsplash.com/photos/random` — 5 destination-specific queries per search |
| Hotel hero uniqueness | Each hotel gets `imagePool[i % pool.length]` — unique starting offset per hotel |
| Hotel gallery uniqueness | Each hotel's `images[]` is a rotated slice of the pool (no two hotels have same order) |
| Destination chips (chat welcome screen) | `images.unsplash.com` direct photo IDs in `app/chat/page.tsx` |
| Discovery landing cards | `api.unsplash.com/photos/random` via `/api/discover` route |

Hotel cards support a full image gallery with left/right arrows and dot indicators (`HotelCard.tsx` → `HotelImageGallery` component).

---

## 7. Date Handling (Critical)

The system prompt is generated **dynamically per request** via `buildSystem()` in `app/api/chat/route.ts`.

- Bot always knows today's actual date (e.g. "Wednesday, March 18, 2026")
- Always suggests future dates, never past ones
- Correctly handles "next month", "summer", "soon" relative to the real current date
- Corrects the user if they accidentally mention a past date

**Never use a static `const SYSTEM = ...` string** — always call `buildSystem()`.

---

## 8. [CARD] Tag Format (AI Output Protocol)

The AI outputs structured data inline as JSON tags. `parseEmbeddedCards()` in `lib/utils.ts` parses these using balanced-bracket extraction.

```
[FLIGHT_CARD] {...}               → renders FlightCard component
[HOTEL_CARD] {...}                → renders HotelCard component (with images[] gallery)
[BOOKING_CONFIRMED] {...}         → renders BookingCard — flight confirmation
[HOTEL_BOOKING_CONFIRMED] {...}   → renders BookingCard — hotel confirmation
[PAYMENT_REQUIRED] {...}          → renders StripePaymentForm (embedded in-chat)
[ITINERARY] {...} [/ITINERARY]    → parsed into ItinerarySidebar
[*_CARD_SHOWN]                    → compressed stub (old messages, saves tokens)
```

**`stripCardTags()` streaming behaviour:**
During streaming, if the AI is mid-way through a `[HOTEL_CARD] {...}` block, `extractBalancedJson` returns `null`. The function `break`s at that point, hiding everything from the incomplete tag onwards — so raw JSON never flickers as text in the chat. Once streaming completes, the full JSON is parsed and stripped cleanly.

**BookingConfirmation JSON must always use:**
- `fareAmount`: `totalAmount` from the `bookFlight` tool result (actual Duffel charge)
- `serviceFee`: always `0` (fee collected separately via Stripe `[PAYMENT_REQUIRED]`)
- `total`: same as `fareAmount`
- `status`: `"confirmed"`

**[PAYMENT_REQUIRED] emitted ONCE after all bookings (flight + hotel) confirmed.**

---

## 9. Key Files

| File | Purpose | Status |
|---|---|---|
| `app/page.tsx` | Discovery landing page — trending cards, floating UI | ✅ Active |
| `app/chat/page.tsx` | Main chat UI — selection handlers, auto-sends from sessionStorage | ✅ Active |
| `app/api/chat/route.ts` | Claude orchestrator, all tools, `buildSystem()`, token compression | ✅ Active |
| `app/api/discover/route.ts` | Gemini-powered discover API, daily in-memory cache | ✅ Active |
| `app/api/book/route.ts` | Booking validation endpoint | ✅ Active |
| `app/api/stripe/create-payment-intent/route.ts` | Creates Stripe PaymentIntent for $20 fee | ✅ Active |
| `app/api/debug/liteapi/route.ts` | LiteAPI debug — hotel list + rates test + raw response | ⚠️ Remove pre-live |
| `app/booking/page.tsx` | Post-booking confirmation page | ✅ Active |
| `components/ChatMessage.tsx` | Message renderer, card parser, streaming/complete split, ComposingBlock | ✅ Active |
| `components/StripePaymentForm.tsx` | Embedded Stripe payment — CDN-loaded, no npm, teal theme | ✅ Active |
| `components/FlightCard.tsx` | Flight result card with airline logo fallback | ✅ Active |
| `components/HotelCard.tsx` | Hotel card with image gallery/carousel | ✅ Active |
| `components/ItinerarySidebar.tsx` | Trip itinerary sidebar | ✅ Active |
| `lib/search/types.ts` | Unified search interfaces | ✅ Active |
| `lib/search/duffel.ts` | Duffel flight provider | ✅ Active |
| `lib/search/amadeus.ts` | Amadeus flights + hotels (fallback) | ✅ Active |
| `lib/search/liteapi.ts` | LiteAPI v3.0 hotel provider — `checkin`/`checkout` field names | ✅ Active |
| `lib/search/aggregator.ts` | Parallel multi-source aggregation, sample fallback | ✅ Active |
| `lib/scoring/flexibility.ts` | Flight flexibility scoring engine — Duffel conditions → 0-1 score + label + penalty summary | ✅ Active |
| `lib/ai/grok.ts` | Grok REST client | ⏸️ Dormant |
| `lib/ai/gemini.ts` | Gemini REST client | ✅ Active |
| `lib/stripe.ts` | `createPaymentIntent()` — raw fetch, no SDK | ✅ Active |
| `lib/types.ts` | Shared TypeScript types incl. `PaymentRequiredData`, `EmbeddedCard` union | ✅ Active |
| `lib/utils.ts` | `parseEmbeddedCards`, `stripCardTags`, `compressMessageHistory`, `airlineLogo` | ✅ Active |

---

## 10. Bug History & Fixes Applied

| Bug | Root Cause | Fix |
|---|---|---|
| Hotel images broken ("?") | `source.unsplash.com` deprecated | Replaced with `images.unsplash.com` CDN + proper API calls |
| Airline logo crashes app | `??` doesn't catch empty string `""` src | `AirlineLogo` component using `\|\|`, with DOM fallback icon |
| Booking "something went wrong" | Duffel requires passenger `id` (pas_xxx) from offer | Step 1: GET offer → extract IDs; Step 2: POST order with IDs |
| Booking wrong total in chat | AI used displayed search price, not actual Duffel charge | System prompt WARNING + `fareAmount` field from tool result |
| `data.status.toUpperCase()` crash | AI omits `status` field in `[BOOKING_CONFIRMED]` JSON | `(data.status ?? 'CONFIRMED').toUpperCase()` |
| Bot suggests 2025 dates | Static system prompt with no date context | `buildSystem()` injects today's real date on every request |
| Amadeus offer booking failure | Amadeus IDs can't be passed to Duffel `/air/orders` | Guard in `bookFlight` + `searchBookableFlights` tool |
| Payment amount `"0"` rejected | Hardcoded amount didn't match offer total | Use `offerData.data?.total_amount` from live offer fetch |
| Landing card click no-ops | URL `?q=` param: React Strict Mode double-invokes effect, timer cancelled | `sessionStorage` + `useState` initializer (runs exactly once) |
| Raw JSON flickers in chat during streaming | `stripCardTags` fell through on incomplete JSON | `break` when `extractBalancedJson` returns null — hides mid-stream blocks |
| All hotel photos identical | Same `imagePool` array assigned to all hotels | Always assign `imagePool[offset]`, rotate gallery slice per hotel |
| Only 1 passenger booked for 2 adults | AI never passed `adults` count to searchFlights | System prompt updated; schema description updated |
| Anthropic 429 rate limit (30k tokens/min) | Full card JSON resent in every message history | `compressMessageHistory()` replaces old card JSON with stubs; ~40% shorter system prompt |
| Stripe `@stripe/react-stripe-js` blocked | npm registry blocks Stripe packages in sandbox | Load `stripe.js` from CDN dynamically via `document.createElement('script')` |
| TypeScript error on `compressMessageHistory` | Generic type `T extends { role, content }` conflicted | Changed to `T extends Record<string, any>` |
| Hotels showing "sample data" / non-bookable | Amadeus hotel search used for all hotels; LiteAPI not wired in | Added `LiteApiProvider` as primary hotel source; Amadeus demoted to fallback |
| UI streaming flicker / card pop-in | Cards parsed during streaming from partial JSON | `ChatMessage` skips ALL card parsing when `streaming=true`; shows `ComposingBlock` |
| LiteAPI hotel rates returning HTTP 400 (code 4002) | Request body used `checkinDate`/`checkoutDate` but v3.0 API requires `checkin`/`checkout` | Fixed field names in `liteapi.ts` and debug endpoint |

---

## 11. Environment Variables

```env
# AI Models
ANTHROPIC_API_KEY=sk-ant-...          ✅ Configured
GEMINI_API_KEY=AIzaSy...              ✅ Configured
GROK_API_KEY=xai-...                  ✅ Configured

# Booking Engines
DUFFEL_ACCESS_TOKEN=duffel_test_...   ✅ Configured (test mode)
AMADEUS_API_KEY=...                   ✅ Configured (also accepts AMADEUS_CLIENT_ID)
AMADEUS_API_SECRET=...                ✅ Configured (also accepts AMADEUS_CLIENT_SECRET)
LITEAPI_KEY=sand_...                  ✅ Configured (sandbox key)

# Experiences
FOURSQUARE_API_KEY=...                ✅ Configured
# VIATOR_API_KEY=                     ⏳ Pending API approval (2–5 days from ~Mar 14)

# Images
UNSPLASH_ACCESS_KEY=...               ✅ Configured

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_test_...         ✅ Configured (test mode)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_... ✅ Configured
STRIPE_WEBHOOK_SECRET=                ⏳ Needed before going live
```

### Duffel Test Mode Notes
- Offers expire in ~15 minutes — search and book in same session
- Requires test balance in account: app.duffel.com → Settings → Test balance → Top up
- Orders appear in app.duffel.com → Orders after successful booking
- Test mode uses sandbox passengers — any DOB/name accepted

### LiteAPI Sandbox Notes
- Sandbox key prefix: `sand_` — limited hotel inventory
- v3.0 rates endpoint uses `checkin`/`checkout` (not `checkinDate`/`checkoutDate`)
- `occupancies` must include `children: []` array even when empty
- Dates must be within sandbox's supported range (typically 2–12 weeks from today)
- Debug endpoint: `/api/debug/liteapi?dest=Cancun&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD`

### Stripe Notes
- Test card: `4242 4242 4242 4242`, any future expiry, any CVC
- Currency: CAD for Canadian origin airports (IATA starts with Y), USD otherwise
- Amount: always 2000 cents ($20)
- No webhook needed for test; required before going live (for payment confirmation events)

---

## 12. Build Phase Tracker

| Phase | Description | Status |
|---|---|---|
| 1 | Project scaffold + steering doc | ✅ Done |
| 2 | Multi-source search (Duffel + Amadeus parallel) | ✅ Done |
| 3 | Gemini + Grok REST clients (no SDK) | ✅ Done |
| 4 | End-to-end booking: offer fetch → passenger ID mapping → Duffel order | ✅ Done |
| 5 | North America UX, destination chips, legal disclaimers | ✅ Done |
| 6 | Stripe embedded PaymentElement ($20 CAD/USD, in-chat, no redirect) | ✅ Done |
| 7 | Hotel image gallery + Unsplash enrichment (unique per hotel) | ✅ Done |
| 8 | Booking confirmation card with fare breakdown | ✅ Done |
| 9 | Dynamic date context in system prompt | ✅ Done |
| 10 | Flight filter/sort + streaming ComposingBlock (no skeleton flicker) | ✅ Done |
| 11 | Discovery landing page (`/`) with Gemini-powered trending cards | ✅ Done |
| 12 | Landing → chat card-click flow (sessionStorage, React Strict Mode safe) | ✅ Done |
| 13 | Streaming JSON flicker fix (`stripCardTags` break-on-incomplete) | ✅ Done |
| 14 | Multi-passenger booking (N adults → N passenger records → N Duffel slots) | ✅ Done |
| 15 | Token compression — `compressMessageHistory()` + shorter system prompt | ✅ Done |
| 16 | LiteAPI v3.0 hotel provider (primary bookable hotel source) | ✅ Done |
| 17 | Select-all-first booking flow (flight + hotel → details → single payment) | ✅ Done |
| 18 | Currency detection: CAD for Canadian airports, USD for US | ✅ Done |
| 19 | LiteAPI rates HTTP 400 fix — `checkin`/`checkout` field names | ✅ Done |
| 20 | v1.4 dynamic system prompt (no regex gates, intent-driven tools) | ✅ Done |
| 21 | Non-stop filter: `maxConnections` param end-to-end to Duffel API | ✅ Done |
| 22 | Return leg stop counts in tool summary (prevents hallucination) | ✅ Done |
| 23 | Airline fare brand names + baggage per variant in FlightCard | ✅ Done |
| 24 | Explicit penalty currency display (EUR/USD per airline policy) | ✅ Done |
| 25 | Viator bookable experiences integration | ⏳ Waiting for API approval |
| 26 | Stripe webhook handler | ⏳ Needed pre-live |
| 27 | Stripe live keys + production deploy | ⏳ Owner approval needed |

---

## 13. Feature Backlog (Next Additions)

| Feature | Priority | Effort | Notes |
|---|---|---|---|
| Viator experiences integration | 🔴 High | Medium | API approval pending; wire bookable experiences once key received |
| Stripe webhook handler | 🔴 High | Low | Required before going live for payment confirmation events |
| Stripe live keys + production deploy | 🔴 High | Low | Just env vars + Stripe dashboard config |
| Remove/gate `/api/debug/liteapi` | 🔴 High | Low | Must be done before going live — exposes hotel IDs and API structure |
| Hotel detail modal/drawer | 🟡 Medium | Medium | Show amenities, map, reviews on click |
| Email booking confirmation | 🟡 Medium | Low | Resend or SendGrid after Duffel/LiteAPI order succeeds |
| Multi-city trip planning | 🟡 Medium | High | Complex routing through multiple destinations |
| User accounts + booking history | 🟡 Medium | High | Auth (Clerk/NextAuth) + DB (Supabase/PlanetScale) |
| Google Maps destination pin | 🟠 Low | High | Mapbox or Google Maps embed per destination |
| Traveler count picker in UI | 🟠 Low | Low | Visual stepper instead of text input |
| Price alerts / watchlists | 🟠 Low | High | Cron job + DB + email notifications |
| Provider registry / model swap | 🟠 Low | Medium | `ACTIVE_AI_MODEL` env var to switch between Claude/Gemini/Grok |
| Loyalty program integration | 🟠 Low | Very High | Points/miles estimation per airline |
| Mobile app (React Native) | 🟠 Low | Very High | Shared API layer, native UX |

---

## 14. Architecture Decisions Log

| Decision | Rationale |
|---|---|
| No Railway backend | Timed out; all logic moved to Next.js API routes — simpler, fewer failure points |
| No `@ai-sdk/google` or `@ai-sdk/xai` | npm registry blocked in sandbox; implemented as direct REST fetch |
| No `stripe` npm package | Same registry issue; Stripe REST API used with form-encoded bodies |
| No `@stripe/react-stripe-js` | npm registry blocked; Stripe.js loaded from CDN via `document.createElement('script')` |
| Amadeus = reference only | Free self-service tier doesn't support booking; Duffel (IATA-licensed) handles all orders |
| LiteAPI = primary hotel source | Bookable hotel API with global inventory; Amadeus demoted to fallback |
| `buildSystem()` not `const SYSTEM` | Date must be injected fresh on each request so bot knows the real current year/date |
| `images.unsplash.com` CDN | `source.unsplash.com` deprecated Oct 2023; proper API or direct photo IDs required |
| `sessionStorage` for landing→chat prompt | URL `?q=` params unreliable across Next.js router cache; sessionStorage survives navigation |
| `useState` initializer for sessionStorage read | React Strict Mode double-invokes `useEffect` with `[]`; state initializers run exactly once |
| `/api/discover` in-memory daily cache | Gemini calls are slow (3–8s); cache by date+region so only first visitor each day pays the cost |
| `compressMessageHistory()` | Anthropic 429 at 30k input tokens/min; replace old card JSON with stubs to cut 3–8k tokens/request |
| `streaming=true` skips all card parsing | Eliminates flicker from partial JSON during stream; ComposingBlock provides clean progress UX |
| Single `[PAYMENT_REQUIRED]` after all bookings | One Stripe charge for the full trip (flight + hotel) rather than separate charges per service |
| `serviceFee: 0` in booking confirmations | Service fee collected via Stripe separately; avoids double-showing fee in booking card |
| v1.4: No regex gates in system prompt | Removed `isDubai`, `isCOK`, `isPacific` regex checks; routing intelligence is always-on, no conditional injection |
| v1.4: Intent-driven tool calling | Maya decides tool strategy from user intent + few-shot examples, not forced parallel batch |
| v1.4: Airline fare brand names over generic labels | Use Duffel's `fare_brand_name` (e.g. "Economy Light") instead of our Value/Plus/Premium when available |
| v1.4: Penalty amounts in airline's native currency | Duffel returns penalties in airline's currency (e.g. EUR for Lufthansa); display as-is with cross-currency note |
| v1.4: Baggage extracted per variant | `segments[].passengers[].baggages` → checked bag count shown per fare tier tab |

---

## 15. Rollback Instructions

**v1.2 checkpoint** (6237bd7):
```bash
git checkout 6237bd7
```

**v1.0-stable checkpoint** (2026-03-08):
```bash
git checkout v1.0-stable
# or
git reset --hard v1.0-stable
```

**v1.0-stable** includes: discovery landing, flight search/booking, hotel search (sample), multi-passenger, streaming flicker fix, dynamic dates.

**v1.2** adds: LiteAPI hotel provider, Stripe embedded payment, select-all-first booking flow, token compression, ComposingBlock UI, currency detection (CAD/USD).

**v1.3** adds: LiteAPI `checkin`/`checkout` field name fix (was returning HTTP 400), debug endpoint enhanced with raw response preview.

**v1.4-stable (current, 3531b79, 2026-04-19):**
```bash
git checkout v1.4-stable
```
Adds: v1.4 dynamic system prompt (no regex gates, intent-driven tool calling), non-stop filter via `maxConnections` end-to-end to Duffel API, return leg stop counts in tool summary (prevents non-stop hallucination), airline fare brand names from Duffel (`fare_brand_name`), baggage per variant (`checked_bags`), explicit penalty currency display with cross-currency note, fare variant UI improvements (Value/Plus/Premium when conditions identical, condition labels only when they differ).

---
*Document maintained by Claude. Update after each feature addition or bug fix.*
