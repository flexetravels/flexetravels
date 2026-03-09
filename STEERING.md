# FlexeTravels — Steering Document
> Last updated: 2026-03-08 | Environment: Staging | Status: **v1.0 Checkpoint — Full booking + discovery flow working**

---

## 1. Project Overview

**FlexeTravels** is an AI-powered travel booking platform targeting North American customers. It provides end-to-end flight and hotel discovery via a conversational AI chatbot, plus a dynamic discovery landing page — aggregating prices across multiple booking engines and charging a flat **$20 service fee** per transaction.

| Item | Value |
|---|---|
| Owner | Suman (sumanthumboli@gmail.com) |
| Brand | FlexeTravels |
| Target Market | North America (Canada + USA) |
| Business Model | $20 flat fee per booking transaction |
| IATA / CPBC Licence | **None** — platform is a tech aggregator, not a licensed travel agent |
| Tech Stack | Next.js 15, React 19, TypeScript, TailwindCSS |
| AI Models | Claude Sonnet (primary), Gemini 2.0 Flash (destination guides + discover), Grok 3 Fast (price intel) |
| Flight Booking | Duffel API — live, IATA-accredited, test mode |
| Flight Reference | Amadeus Self-Service API — price comparison only, NOT bookable |
| Hotels | Amadeus Hotel List + Hotel Offers (live), sample fallback |
| Images | Unsplash API (`api.unsplash.com`, never deprecated `source.unsplash.com`) |
| Payment | Stripe REST client — test mode, $20 service fee only |
| Backend | All logic in Next.js API routes (no Railway, no separate backend) |
| Repo Path | `/flexetravels-next` (Next.js 15 App Router) |
| Git Checkpoint | `v1.0-stable` — tagged at session end 2026-03-08 |

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
│  app/page.tsx              ← Discovery landing page               │
│  app/chat/page.tsx         ← Main chat UI                         │
│  app/api/chat/route.ts     ← Claude orchestrator + all tools      │
│  app/api/discover/route.ts ← Gemini-powered trending cards        │
│  app/api/book/route.ts     ← Dedicated booking validation         │
│  app/api/stripe/           ← Stripe checkout + webhook            │
│  app/booking/page.tsx      ← Post-booking confirmation page       │
└───────────────────────┬──────────────────────────────────────────┘
                        │ tool calls
        ┌───────────────┼──────────────────┬──────────────┐
        ▼               ▼                  ▼              ▼
   Duffel API      Amadeus API        Unsplash API    Gemini API
 (bookable flights) (price ref +    (hotel/dest      (destination
                     hotels)          images)          guides +
                                                       discover)
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

### 3.2 Booking Architecture (Critical)

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

### 3.4 `/api/discover` — Daily Trending Cards

- Detects user region from Vercel `x-vercel-ip-country` / Cloudflare `cf-ipcountry` headers
- Calls **Gemini 2.0 Flash** with a structured prompt requesting 6 destinations, 4 events, 4 experiences as JSON
- Fetches **Unsplash images** for each card in parallel
- Results cached **in-memory per date+region key** (`YYYY-MM-DD:CC`) — Gemini called once per day
- Falls back to curated static data if Gemini is unavailable or returns malformed JSON
- `geminiGenerate()` accepts optional `{ maxOutputTokens, temperature }` to support the larger 4096-token response

---

## 4. Legal & Compliance (No IATA/CPBC)

Since FlexeTravels operates **without IATA or CPBC accreditation**:

1. **Technology Platform Disclosure** — all pages and chat responses state:
   > *"FlexeTravels is a travel technology platform, not a licensed travel agent. Flight bookings are processed through Duffel (IATA-accredited). FlexeTravels charges a $20 service fee for search aggregation and booking facilitation."*

2. **Payment Split**:
   - Duffel charges flight/hotel cost directly (via `balance` payment in test mode)
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
| AmadeusProvider | `lib/search/amadeus.ts` | ✅ Live (free tier) | ✅ Live | ❌ Reference only |
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

- Bot always knows today's actual date (e.g. "Sunday, March 8, 2026")
- Always suggests future dates, never past ones
- Correctly handles "next month", "summer", "soon" relative to the real current date
- Corrects the user if they accidentally mention a past date

**Never use a static `const SYSTEM = ...` string** — always call `buildSystem()`.

---

## 8. [CARD] Tag Format (AI Output Protocol)

The AI outputs structured data inline as JSON tags. `parseEmbeddedCards()` in `lib/utils.ts` parses these using balanced-bracket extraction.

```
[FLIGHT_CARD] {...}          → renders FlightCard component
[HOTEL_CARD] {...}           → renders HotelCard component (with images[] gallery)
[BOOKING_CONFIRMED] {...}    → renders BookingCard with fare + $20 fee breakdown
[ITINERARY] {...} [/ITINERARY] → parsed into ItinerarySidebar
```

**`stripCardTags()` streaming behaviour:**
During streaming, if the AI is mid-way through a `[HOTEL_CARD] {...}` block, `extractBalancedJson` returns `null`. The function `break`s at that point, hiding everything from the incomplete tag onwards — so raw JSON never flickers as text in the chat. Once streaming completes, the full JSON is parsed and stripped cleanly.

**BookingConfirmation JSON must always use:**
- `fareAmount`: `totalAmount` from the `bookFlight` tool result (actual Duffel charge)
- `serviceFee`: always `20`
- `total`: `fareAmount + 20`
- `status`: `"confirmed"`

---

## 9. Key Files

| File | Purpose | Status |
|---|---|---|
| `app/page.tsx` | Discovery landing page — trending cards, floating UI | ✅ Active |
| `app/chat/page.tsx` | Main chat UI — auto-sends from sessionStorage on mount | ✅ Active |
| `app/api/chat/route.ts` | Claude orchestrator, all tools, `buildSystem()` | ✅ Active |
| `app/api/discover/route.ts` | Gemini-powered discover API, daily in-memory cache | ✅ Active |
| `app/api/book/route.ts` | Booking validation endpoint | ✅ Active |
| `app/api/stripe/checkout/route.ts` | Stripe $20 checkout session | ✅ Ready (needs live keys) |
| `app/api/stripe/webhook/route.ts` | Stripe webhook handler | ✅ Ready |
| `app/booking/page.tsx` | Post-booking confirmation page | ✅ Active |
| `components/ChatMessage.tsx` | Message renderer, card parser, skeleton loaders, filter/sort panels | ✅ Active |
| `components/FlightCard.tsx` | Flight result card with airline logo fallback | ✅ Active |
| `components/HotelCard.tsx` | Hotel card with image gallery/carousel | ✅ Active |
| `components/ItinerarySidebar.tsx` | Trip itinerary sidebar | ✅ Active |
| `lib/search/types.ts` | Unified search interfaces | ✅ Active |
| `lib/search/duffel.ts` | Duffel flight provider | ✅ Active |
| `lib/search/amadeus.ts` | Amadeus flights + hotels | ✅ Active |
| `lib/search/aggregator.ts` | Parallel multi-source aggregation, sample fallback | ✅ Active |
| `lib/ai/grok.ts` | Grok REST client | ✅ Active |
| `lib/ai/gemini.ts` | Gemini REST client — accepts optional `{ maxOutputTokens, temperature }` | ✅ Active |
| `lib/stripe.ts` | Stripe REST client (no SDK) | ✅ Active |
| `lib/types.ts` | Shared TypeScript types | ✅ Active |
| `lib/utils.ts` | `parseEmbeddedCards`, `stripCardTags` (streaming-safe), `airlineLogo` | ✅ Active |

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
| Raw JSON flickers in chat during streaming | `stripCardTags` fell through to `pos = j` on incomplete JSON, leaking `{...` | `break` when `extractBalancedJson` returns null — hides mid-stream blocks |
| All hotel photos identical | Condition `hotel.image.includes('source.unsplash.com')` false for fallback images; `hotel.images = imagePool` same array for all | Always assign `imagePool[offset]`, rotate gallery slice per hotel |
| Only 1 passenger booked for 2 adults | System prompt said "collect passenger details" (singular); AI never passed `adults` count to searchFlights | System prompt updated with explicit N-passenger protocol; schema description updated |

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

# Images
UNSPLASH_ACCESS_KEY=...               ✅ Configured

# Payments (Stripe)
STRIPE_SECRET_KEY=                    ⏳ Add when ready for payment phase
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=   ⏳ Add when ready for payment phase
STRIPE_WEBHOOK_SECRET=                ⏳ Add when ready for payment phase
```

### Duffel Test Mode Notes
- Offers expire in ~15 minutes — search and book in same session
- Requires test balance in account: app.duffel.com → Settings → Test balance → Top up
- Orders appear in app.duffel.com → Orders after successful booking
- Test mode uses sandbox passengers — any DOB/name accepted

---

## 12. Build Phase Tracker

| Phase | Description | Status |
|---|---|---|
| 1 | Project scaffold + steering doc | ✅ Done |
| 2 | Multi-source search (Duffel + Amadeus parallel) | ✅ Done |
| 3 | Gemini + Grok REST clients (no SDK) | ✅ Done |
| 4 | End-to-end booking: offer fetch → passenger ID mapping → Duffel order | ✅ Done |
| 5 | North America UX, destination chips, legal disclaimers | ✅ Done |
| 6 | Stripe $20 service fee (REST, no SDK) | ✅ Ready |
| 7 | Hotel image gallery + Unsplash enrichment (unique per hotel) | ✅ Done |
| 8 | Booking confirmation card with fare breakdown | ✅ Done |
| 9 | Dynamic date context in system prompt | ✅ Done |
| 10 | Flight filter/sort + skeleton loaders in chat | ✅ Done |
| 11 | Discovery landing page (`/`) with Gemini-powered trending cards | ✅ Done |
| 12 | Landing → chat card-click flow (sessionStorage, React Strict Mode safe) | ✅ Done |
| 13 | Streaming JSON flicker fix in chat (`stripCardTags` break-on-incomplete) | ✅ Done |
| 14 | Multi-passenger booking (N adults → N passenger records → N Duffel slots) | ✅ Done |
| 15 | Stripe live keys + production deploy | ⏳ Owner approval needed |

---

## 13. Feature Backlog (Next Additions)

| Feature | Priority | Effort | Notes |
|---|---|---|---|
| Stripe live keys + production deploy | 🔴 High | Low | Just env vars + Stripe dashboard config |
| Hotel detail modal/drawer | 🟡 Medium | Medium | Show amenities, map, reviews on click |
| Multi-city trip planning | 🟡 Medium | High | Complex routing through multiple destinations |
| Direct hotel booking | 🟡 Medium | High | Duffel doesn't cover hotels; need Booking.com or Hotels.com API |
| User accounts + booking history | 🟡 Medium | High | Auth (Clerk/NextAuth) + DB (Supabase/PlanetScale) |
| Email booking confirmation | 🟡 Medium | Low | Resend or SendGrid after Duffel order succeeds |
| Google Maps destination pin | 🟠 Low | High | Mapbox or Google Maps embed per destination |
| Traveler count picker in UI | 🟠 Low | Low | Visual stepper instead of text input |
| Price alerts / watchlists | 🟠 Low | High | Cron job + DB + email notifications |
| Loyalty program integration | 🟠 Low | Very High | Points/miles estimation per airline |
| Mobile app (React Native) | 🟠 Low | Very High | Shared API layer, native UX |

---

## 14. Architecture Decisions Log

| Decision | Rationale |
|---|---|
| No Railway backend | Timed out; all logic moved to Next.js API routes — simpler, fewer failure points |
| No `@ai-sdk/google` or `@ai-sdk/xai` | npm registry blocked in sandbox; implemented as direct REST fetch |
| No `stripe` npm package | Same registry issue; Stripe REST API used with form-encoded bodies |
| Amadeus = reference only | Free self-service tier doesn't support booking; Duffel (IATA-licensed) handles all orders |
| `buildSystem()` not `const SYSTEM` | Date must be injected fresh on each request so bot knows the real current year/date |
| `images.unsplash.com` CDN | `source.unsplash.com` deprecated Oct 2023; proper API or direct photo IDs required |
| `sessionStorage` for landing→chat prompt | URL `?q=` params unreliable across Next.js router cache; sessionStorage survives navigation |
| `useState` initializer for sessionStorage read | React Strict Mode double-invokes `useEffect` with `[]`; state initializers run exactly once |
| `/api/discover` in-memory daily cache | Gemini calls are slow (3–8s); cache by date+region so only first visitor each day pays the cost |
| Gemini for discover, not Claude | Cheaper per token for structured JSON generation; Claude reserved for live conversational UX |

---

## 15. Rollback Instructions

To rollback to the **v1.0-stable** checkpoint:

```bash
git checkout v1.0-stable        # restore all files
# or
git reset --hard v1.0-stable    # reset working tree to checkpoint
```

This checkpoint represents a fully working state with:
- ✅ Discovery landing page with Gemini-powered trending cards
- ✅ Card click → chat auto-send (sessionStorage, React Strict Mode safe)
- ✅ Flight search (Duffel + Amadeus), hotel search (Amadeus + sample)
- ✅ End-to-end flight booking via Duffel with multi-passenger support
- ✅ Booking confirmation card with accurate fare + $20 fee breakdown
- ✅ Hotel image gallery with unique photos per hotel
- ✅ Flight filter/sort (stops, price, duration) + skeleton loaders
- ✅ Dynamic date context (bot never suggests past dates)
- ✅ Streaming JSON flicker eliminated
- ✅ TypeScript: zero compile errors

---
*Document maintained by Claude. Update after each feature addition or bug fix.*
