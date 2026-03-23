# FlexeTravels — Product Documentation

> Last updated: 2026-03-22

---

## Table of Contents

1. [What FlexeTravels Is](#what-flexetravels-is)
2. [Full Architecture](#full-architecture)
3. [Feature Inventory (What's Working)](#feature-inventory-whats-working)
4. [Gap Analysis vs Airial.travel](#gap-analysis-vs-airialtravel)
5. [Gap Analysis vs Layla.ai](#gap-analysis-vs-laylaai)
6. [Roadmap — Prioritised](#roadmap--prioritised)
7. [Known Bugs & Guardrails](#known-bugs--guardrails)
8. [API Keys & Services](#api-keys--services)
9. [Deployment](#deployment)

---

## What FlexeTravels Is

FlexeTravels is an AI-powered travel booking concierge targeting **North American travellers**. Users describe a trip in natural language; the AI searches real flights and hotels in parallel, presents bookable options as interactive cards inside the chat, and completes the booking (including Stripe payment and passenger collection) entirely in-page — no redirects, no OTA handoffs.

**Business model:** Flat $20 CAD service fee per booking, charged via Stripe. Flights booked through Duffel (IATA-accredited). Hotels booked through LiteAPI.

---

## Full Architecture

```
Browser  ──►  Next.js 15 App Router (Railway)
               │
               ├── /  (Landing — Discovery page)
               │       Calls /api/discover → AI-curated trending cards
               │
               ├── /chat  (Main experience)
               │       useChat (Vercel AI SDK) → POST /api/chat
               │       Claude claude-sonnet-4-5 orchestrator
               │       Streaming response with embedded JSON cards
               │
               └── /booking  (Checkout)
                       Reads sessionStorage('ft_cart')
                       POST /api/book-trip → Duffel + LiteAPI
                       Stripe Payment Element (inline)

AI Layer (per chat request)
├── Primary:     Claude claude-sonnet-4-5  — orchestrator, conversation, tool dispatch
├── Market intel: Grok xAI                — price comparison, deal context
└── Destination: Gemini 1.5 Flash         — travel guides, alternative suggestions

Search / Booking Layer
├── Flights:  Duffel API  (bookable — provider="duffel")
│             Amadeus API (price reference only — NOT bookable)
├── Hotels:   LiteAPI     (live rates — sandbox key = sand_, production = prod_)
│             Amadeus hotels (fallback)
├── Experiences: Foursquare (POI discovery)
│                OpenTripMap (POI fallback)
└── Images:   Unsplash API (hotel hero images when LiteAPI doesn't provide)

Payments
└── Stripe Payment Element → /api/stripe/checkout or /api/stripe/create-payment-intent
    Flat $20 fee collected before /api/book-trip fires

Key files
├── app/api/chat/route.ts          — system prompt + tool definitions + streaming
├── app/api/book-trip/route.ts     — booking orchestrator (Duffel + LiteAPI + Stripe verify)
├── app/chat/page.tsx              — chat UI, card selection, session cart
├── app/booking/page.tsx           — checkout page, stale-cart detection
├── components/ChatMessage.tsx     — renders FLIGHT_CARD / HOTEL_CARD / EXPERIENCE_CARD
├── components/CheckoutCard.tsx    — passenger form, adults stepper, Stripe, booking guard
├── components/FlightCard.tsx      — flight option card UI
├── components/HotelCard.tsx       — hotel option card UI with image carousel
├── components/ItinerarySidebar.tsx — drag-drop day planner (accessible from chat)
├── lib/search/aggregator.ts       — fan-out search across all providers
├── lib/search/duffel.ts           — Duffel flight search + booking
├── lib/search/liteapi.ts          — LiteAPI hotel search + prebook + book
└── lib/utils.ts                   — parseEmbeddedCards, extractBalancedJson, etc.
```

---

## Feature Inventory (What's Working)

### Landing Page (`/`)
- [x] AI-curated **trending destinations** grid (portrait cards)
- [x] **Trending events** grid (concerts, festivals, sports, F1)
- [x] **Trending experiences** grid (wellness, adventure, culture)
- [x] Each card generates a chat prompt on click → navigates to `/chat?q=...`
- [x] Daily refresh with skeleton loading states
- [x] Dark background with teal gradient branding
- [x] "Plan a Trip" CTA to `/chat`

### Chat Page (`/chat`)
- [x] **Welcome screen** with destination chips (8 cities) + AI prompt on click
- [x] Real-time **streaming AI responses** (Vercel AI SDK)
- [x] **FLIGHT_CARD** embedded JSON cards with horizontal carousel
- [x] **HOTEL_CARD** embedded JSON cards with horizontal carousel + image gallery
- [x] **EXPERIENCE_CARD** grid (up to 6 POIs)
- [x] Select flight → `[FLIGHT_SELECTED]` state machine → hotel confirmation
- [x] Select hotel → cart saved to `sessionStorage('ft_cart')` → navigate to `/booking`
- [x] **Stale cart detection** (10-minute warning on `/booking`)
- [x] **Itinerary sidebar** (drag-drop days, activities by category, flight/hotel tiles)
- [x] Dark / light theme toggle
- [x] Keyboard shortcut Cmd+K to focus input
- [x] Scroll-to-bottom button (auto-hides when at bottom)
- [x] **No-flight confirmation modal** (proceeds hotel-only if user confirms)
- [x] Placeholder ID detection (prevents silent booking failures)
- [x] **Children info parsing** (`[CHILDREN_INFO]` tag → pre-fills checkout form)
- [x] Message history compression (keeps context under token limits)

### Booking Page (`/booking`)
- [x] **CheckoutCard** with passenger form (adults stepper, names, DOB, email, phone)
- [x] **Stripe Payment Element** (inline card input)
- [x] Adults stepper capped at party size from search
- [x] Stale-cart amber warning banner
- [x] Full booking confirmation screen (reference numbers)
- [x] Amadeus flight guard (explicit "not bookable" error)
- [x] LiteAPI hotel token validation

### AI Capabilities
- [x] Qualifies trip: destination → dates → party size → budget
- [x] Parallel search: flights + hotels + experiences + destination guide simultaneously
- [x] Duffel (bookable) vs Amadeus (reference) labelling
- [x] Grok price insight (market context, "is this a good deal?")
- [x] Gemini destination guide (best areas, what to do, when to go)
- [x] Gemini alternatives (suggest similar destinations)
- [x] IATA code resolution for major Canadian/US airports
- [x] Children age collection before search (child fare eligibility)
- [x] Season-aware dates ("next summer" resolves correctly)
- [x] Slash commands: `/summarize` `/budget` `/alternatives` `/edit-day-N` `/add-day`

### Mobile (iOS + Android browser)
- [x] Font-size 1rem on textarea (prevents iOS Safari auto-zoom)
- [x] `env(safe-area-inset-bottom)` on input dock (notch/home indicator)
- [x] `viewportFit: 'cover'` for Dynamic Island
- [x] 44px minimum tap targets on all interactive elements
- [x] Carousel peek pattern (`w-[85vw]`) with `touch-pan-x`
- [x] Carousel arrows always visible on touch, hide-on-hover on desktop
- [x] `@media (hover: none)` guard on card hover effects

---

## Gap Analysis vs Airial.travel

### What Airial Does That We Don't

| Feature | Airial | FlexeTravels | Notes |
|---------|--------|--------------|-------|
| **Trip vibe/style picker** | ✅ (Romantic, Adventure, Culture, Beach tabs) | ❌ | Shown as first step before search |
| **Multi-destination planner** | ✅ (Ubud → Seminyak → Uluwatu) | ❌ | Creates multi-stop itineraries |
| **Interactive map** | ✅ Google Map with destination pins | ❌ | Shows route between stops |
| **Trip Preferences panel** | ✅ (dietary, driving, star rating, cabin class) | ❌ | Persistent settings per trip |
| **Start/end city detection** | ✅ (auto-detects from browser) | ❌ | We require user to state origin |
| **Destination photo cards** | ✅ Rich images in multi-dest list | Partial | We have chip text only on welcome |
| **Route ordering (AI vs manual)** | ✅ | ❌ | "Suggest best route" or "I'll choose" |
| **Like/dislike on AI responses** | ✅ Thumbs up/down + Undo | ❌ | Per-message feedback |
| **Trip history / sidebar** | ✅ "New Trip" button + history | ❌ | No persistence between sessions |
| **"Add another destination" suggestions** | ✅ 8 AI suggestions shown | ❌ | |
| **Day-trip highlights per destination** | ✅ "Includes day trips to Tegalalang..." | Partial | Our sidebar has activities but not linked |
| **"Skip this step" option** | ✅ On every structured step | N/A | We're chat-based so inherently skippable |

### What We Do Better Than Airial
- Actual **in-chat booking** (Airial links out to partners)
- Real-time **Duffel flight prices** (Airial appears to link to Skyscanner)
- **Stripe payment in-page** (no redirect)
- **Trending events/experiences** discovery landing page
- Multi-model AI (Claude + Grok + Gemini)

---

## Gap Analysis vs Layla.ai

### What Layla Does That We Don't

| Feature | Layla | FlexeTravels | Notes |
|---------|-------|--------------|-------|
| **Conversational personality** | ✅ "Like texting a well-traveled friend" | ⚠️ Too formal/structured | See system prompt improvements below |
| **"How do you want to feel?" framing** | ✅ Leads with feelings/vibe | ❌ Leads with dates/destination | Big UX difference |
| **Travel creator video map** | ✅ Viral TikTok/YouTube videos pinned to map | ❌ | Unique differentiator |
| **Visa requirements** | ✅ Per destination | ❌ | |
| **Currency info** | ✅ Live conversion | ❌ | |
| **Best time to visit** | ✅ Auto-included | Partial (Gemini guide has this) | |
| **Multi-city route optimization** | ✅ Train, flight, car rental across stops | ❌ | |
| **Road trip planner** | ✅ Scenic stops, drive times | ❌ | |
| **Family / couple specialization** | ✅ Dedicated planning modes | ❌ | |
| **Holiday / event alerts** | ✅ "There's a festival that week!" | Partial (Grok does this) | |
| **Natural fuzzy queries** | ✅ "Somewhere warm with good food" | ✅ We handle this well | |
| **Booking.com / Skyscanner links** | ✅ Deep links to OTAs | ❌ | We book direct which is better |
| **Persistent user profile** | ✅ Preferences saved | ❌ No login/auth | |

### What We Do Better Than Layla
- **Direct booking** in-page (Layla redirects to Booking.com / Skyscanner)
- **Flat $20 fee** vs Layla taking OTA commissions
- **Duffel confirmed bookings** (not just price references)
- **LiteAPI direct hotel inventory** with confirmed rates

---

## Roadmap — Prioritised

### 🔴 P0 — Do First (highest UX impact, low effort)

1. **Make the AI personality Layla-like**
   - Lead with warmth and vibes, not forms
   - Ask "what kind of trip are you dreaming of?" not "what are your dates?"
   - Use phrases like "ooh, great choice!", "that's going to be amazing!", "pro tip..."
   - Naturally weave in best-time-to-visit, visa notes, currency heads-up
   - Never say "I'll now search for..." — just do it and present results with personality

2. **Vibe/style chips on welcome screen** (replaces plain destination chips)
   - Add category row: 🏖 Beach & Relaxation · 🏔 Adventure · 🎭 Culture & Arts · 💑 Romance · 🌆 City Break · 🦁 Wildlife · 🧘 Wellness · 🍜 Food & Wine
   - Each chip sends a qualifying prompt: "I'm looking for a beach & relaxation trip for 2 adults..."
   - Keep the destination chips below as a second row

3. **Thumbs up / thumbs down feedback** on each AI message
   - Just frontend for now (console.log or `/api/feedback` stub)
   - Signals quality to improve the model over time

4. **Visa + currency quick-facts** in destination guide response
   - Gemini already returns destination info — add a prompt to include passport/visa info and local currency tip

### 🟡 P1 — Next Sprint

5. **Trip preferences panel** (modal or sidebar section)
   - Cabin class preference (economy / business)
   - Hotel star rating preference (3★ / 4★ / 5★)
   - Dietary restrictions (vegetarian, halal, kosher, none)
   - These get injected into the system prompt context per session

6. **Trip history** (localStorage-based, no auth required)
   - Save last 5 chat sessions with destination + dates
   - Show in sidebar as "Recent trips"
   - One-click restore (re-send the original prompt)

7. **"Best time to visit" badge** on hotel/destination cards
   - "June is peak season — book early" amber badge
   - "June is shoulder season — great value" green badge

8. **Destination photo on welcome chips**
   - Show real destination photos instead of just text chips
   - Already done for 8 chips — extend to vibe chips

### 🟢 P2 — Future

9. **Multi-destination trip planning**
   - After first destination is booked, AI asks "Adding a second stop?"
   - Builds multi-leg itinerary with connecting flights

10. **Interactive map view**
    - Mapbox/Google Maps showing hotel pins + experience pins
    - Tap a pin → opens hotel/experience card

11. **User accounts / saved trips**
    - Email magic-link auth
    - Saved itineraries, past bookings, preferences

12. **Road trip / train journey planner**
    - Special prompt mode: "I want to drive from X to Y over N days"
    - Suggests overnight stops, hotels at each stop

13. **Travel creator inspiration feed**
    - Embed curated YouTube Shorts / TikTok videos per destination
    - "Watch: 3 days in Bali with $1,500"

14. **Cancellation & change management**
    - Post-booking: check Duffel order status, LiteAPI booking status
    - "Need to change your booking?" flow

---

## Known Bugs & Guardrails

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| AI emits placeholder IDs (N/A, TBD, `<id>`) | Fixed | `PLACEHOLDER_RE` in book-trip + CheckoutCard |
| Amadeus flights not bookable (silent fail) | Fixed | Explicit error + UI guard |
| No Duffel booking attempted (flightOfferId undefined) | Fixed | Intake logging + placeholder detection |
| Adults count mismatch (AI uses 1, user said 2) | Fixed | "couple/we/partner" → adults=2 in system prompt |
| iOS Safari textarea zoom on focus | Fixed | `font-size: 1rem` |
| iOS input dock hidden by keyboard | Fixed | `env(safe-area-inset-bottom)` |
| Carousel arrow invisible on touch | Fixed | `opacity-100` always on touch, hover-only on desktop |
| Cart stale after 10 minutes | Fixed | `savedAt` timestamp + amber warning banner |
| LiteAPI sandbox bookings not in dashboard | Info | Sandbox → test mode in LiteAPI dashboard; expected |
| Child age calculation bug (getDate vs getMonth) | Fixed | Corrected to `getMonth()` |
| TypeScript error: MouseEvent vs boolean on handleBook | Fixed | `onClick={() => void handleBook()}` |

---

## API Keys & Services

| Service | Key prefix | Dashboard |
|---------|-----------|-----------|
| Anthropic (Claude) | `sk-ant-` | console.anthropic.com |
| xAI (Grok) | `xai-` | console.x.ai |
| Google (Gemini) | `AIza` | aistudio.google.com |
| Duffel (flights) | `duffel_test_` / `duffel_live_` | app.duffel.com |
| LiteAPI (hotels) | `sand_` / `prod_` | app.liteapi.travel |
| Stripe | `sk_test_` / `sk_live_` | dashboard.stripe.com |
| Unsplash | `Client-ID ...` | unsplash.com/developers |
| Foursquare | `fsq_` | developer.foursquare.com |
| OpenTripMap | (key in env) | opentripmap.io |

---

## Deployment

**Platform:** Railway (via GitHub auto-deploy on push to `main`)

**To deploy:**
```bash
git push origin main
```
Railway auto-builds and deploys. No manual step needed after pushing.

**Environment variables** must be set in Railway dashboard (`Variables` tab):
`ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GOOGLE_AI_KEY`, `DUFFEL_API_KEY`,
`LITEAPI_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`UNSPLASH_ACCESS_KEY`, `FOURSQUARE_API_KEY`, `OPENTRIPMAP_KEY`

**Note:** VM cannot `git push` directly (proxy restriction). Always push from your local terminal.
