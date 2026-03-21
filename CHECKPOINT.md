# FlexeTravels — Checkpoint v2.0
> March 21 2026 · All systems tested end-to-end

---

## What Works Right Now

### ✅ Flight Booking (Duffel)
- Live Duffel sandbox bookings confirmed (e.g. ref `JE7XG6`)
- Supports 1–6 passengers, economy → first class
- Duffel balance used for payment (no card needed server-side)
- Bookings appear in Duffel dashboard at app.duffel.com

### ✅ Hotel Booking (LiteAPI)
- Live LiteAPI sandbox booking confirmed: `L5D9Z0VqF` at The Westin Cancun
- Full flow: search → prebook → book in ~11 seconds
- Sandbox card hardcoded server-side: `4242424242424242 / ACC_CREDIT_CARD / 12/2028`
- Token format: `liteapi_<offerId>` — detected in `book-trip/route.ts`

### ✅ Stripe Service Fee ($20)
- PaymentElement embedded in Step 3 of CheckoutCard
- Test card for users: `4242 4242 4242 4242` / `12/28` / `123`
- Currency auto-detects: CAD for Canadian origin airports (IATA starts with Y), USD otherwise

### ✅ AI Chat (Claude Sonnet)
- State machine in system prompt prevents premature booking
- `[FLIGHT_SELECTED]` and `[HOTEL_SELECTED]` tags trigger correct states
- Tools: `searchFlights`, `searchHotels`, `searchExperiences`
- Response times: 4–10 seconds for search, 2–5 seconds for conversational

### ✅ CheckoutCard (3-step flow)
- Step 1: Trip review + passenger count stepper
- Step 2: Passenger forms (⚡ Fill test data button in dev mode)
- Step 3: Stripe PaymentElement
- Error handling: blocks if hotel is sample-only; surfaces hotel errors even when flight succeeded

### ✅ Landing Page
- Dynamic discovery cards via Gemini AI (refreshes daily)
- Falls back to curated static content if Gemini unavailable
- All destination cards constrained to LiteAPI-covered cities

---

## Architecture

```
User → /chat → useChat (Vercel AI SDK streamText)
                    ↓
            /api/chat/route.ts  (Claude Sonnet, maxSteps:12)
                    ↓ tools
      ┌─────────────┼──────────────┐
      ↓             ↓              ↓
searchFlights  searchHotels  searchExperiences
  (Duffel +     (LiteAPI)      (Foursquare +
   Amadeus)                    OpenTripMap, 8s cap)
      ↓             ↓
  FlightCard    HotelCard
      ↓             ↓
  handleSelectFlight  handleSelectHotel
  [FLIGHT_SELECTED]   [HOTEL_SELECTED] → CheckoutCard appears
                    ↓
            /api/book-trip (POST)
              ↓              ↓
        bookDuffelFlight   liteApiPrebook → liteApiBook
              ↓
        createPaymentIntent (Stripe)
              ↓
        CheckoutCard Step 3 → Stripe PaymentElement
```

---

## Environment Variables Required

### Core (required)
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (Anthropic console) |
| `DUFFEL_ACCESS_TOKEN` | `duffel_test_xxx` (sandbox) or `duffel_live_xxx` (prod) |
| `LITEAPI_KEY` | `sand_xxx` (sandbox) or `prod_xxx` (production) |
| `STRIPE_SECRET_KEY` | `sk_test_xxx` or `sk_live_xxx` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_xxx` or `pk_live_xxx` |

### Flight search (required)
| Variable | Description |
|---|---|
| `AMADEUS_CLIENT_ID` | Amadeus self-service API credentials |
| `AMADEUS_CLIENT_SECRET` | Amadeus self-service API credentials |

### Experiences (optional — app still works without these)
| Variable | Description |
|---|---|
| `FOURSQUARE_API_KEY` | Foursquare Places API |
| `OPENTRIPMAP_KEY` | OpenTripMap API |
| `GEMINI_API_KEY` | Google Gemini (for dynamic discovery cards on landing page) |

---

## Known Limitations (Pre-production)

1. **LiteAPI inventory gaps** — Works well for major cities. Thin or zero results for remote destinations. Destination chips and home cards now restricted to LiteAPI-confirmed cities.
2. **Amadeus sandbox flights** — Amadeus sometimes returns fewer routes than Duffel in sandbox. Production credentials will expand coverage.
3. **Offer expiry** — Hotel offers from LiteAPI expire. Users who take >15 min on the checkout may get a prebook error. Handled gracefully with an error message.
4. **Stripe webhooks not implemented** — Fee payments are confirmed client-side. Add a webhook for production to record successful payments in your DB.
5. **No booking database** — Booking refs are shown in UI but not persisted. Add a DB before going live.
6. **Test endpoint** — `GET /api/test/hotel-booking` is disabled in production (`NODE_ENV=production` guard) but should be removed or password-protected before public launch.
7. **Gemini quota** — If Gemini API quota is exceeded, landing page falls back to static curated cards (all LiteAPI-safe cities).

---

## Tested Destinations (LiteAPI Confirmed)

These cities return real bookable hotels in LiteAPI sandbox:

**Americas:** Cancun ✅, Punta Cana ✅, Montego Bay, Nassau, San Juan, Miami, New York, Las Vegas, Los Angeles, Honolulu, Chicago, San Francisco, Nashville, New Orleans, Toronto, Vancouver, Montreal, Calgary
**Europe:** London, Paris, Rome, Barcelona, Madrid, Amsterdam, Vienna, Prague, Lisbon, Athens, Dublin, Florence, Venice, Berlin, Munich, Istanbul
**Asia/Pacific:** Tokyo, Osaka, Bangkok, Phuket, Bali, Singapore, Dubai, Abu Dhabi, Hong Kong, Seoul, Sydney, Melbourne
**Latin America:** Lima, Cusco (Peru), Buenos Aires, Rio de Janeiro, Bogota, Cartagena, Santiago

---

## Deployment to flexetravels.com (Vercel)

### Step 1 — Push to GitHub
```bash
cd flexetravels-next
git add -A
git commit -m "checkpoint v2.0: LiteAPI booking working, destinations verified"
git push origin main
```

### Step 2 — Vercel Project Setup
1. Go to [vercel.com](https://vercel.com) → Import Git Repository
2. Select your `flexetravels-next` repo
3. Framework: **Next.js** (auto-detected)
4. Root directory: `/` (or `flexetravels-next` if repo root is different)

### Step 3 — Environment Variables in Vercel
In Vercel dashboard → Settings → Environment Variables, add all variables from the table above.

For initial beta testing, use sandbox/test keys:
- `DUFFEL_ACCESS_TOKEN` = your sandbox token (starts with `duffel_test_`)
- `LITEAPI_KEY` = your sandbox key (starts with `sand_`)
- `STRIPE_SECRET_KEY` = `sk_test_...`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_test_...`

### Step 4 — Custom Domain
1. Vercel dashboard → Settings → Domains
2. Add `flexetravels.com` and `www.flexetravels.com`
3. Update your domain DNS to point to Vercel (they'll show you the exact records)
4. SSL is automatic

### Step 5 — Verify
- Visit `https://flexetravels.com` — landing page loads
- Visit `https://flexetravels.com/chat` — chat loads
- Test a Cancun booking end-to-end

---

## Test Credentials (Sandbox Only)

| What | Credential |
|---|---|
| Stripe card (UI Step 3) | `4242 4242 4242 4242` / `12/28` / `123` |
| LiteAPI card (server-side, hardcoded) | `4242424242424242 / ACC_CREDIT_CARD / 12/2028` |
| API test endpoint | `GET /api/test/hotel-booking` (dev only) |

---

## File Map (Key Files)

```
app/
  page.tsx                    Landing page (discover cards)
  chat/page.tsx               Main chat UI
  api/
    chat/route.ts             AI brain — Claude + tools + state machine
    book-trip/route.ts        Booking orchestrator (Duffel + LiteAPI + Stripe)
    discover/route.ts         Daily trending cards (Gemini + fallback)
    test/hotel-booking/       Dev-only E2E test endpoint

components/
  CheckoutCard.tsx            3-step booking flow
  FlightCard.tsx              Flight result card
  HotelCard.tsx               Hotel result card

lib/search/
  aggregator.ts               Multi-provider search orchestrator
  duffel.ts                   Duffel flight search + booking
  liteapi.ts                  LiteAPI hotel search + prebook + book
  amadeus.ts                  Amadeus flight search
  amadeus-hotels.ts           Amadeus hotel search + booking (available, not active)
  foursquare.ts               Experience search
  opentripmap.ts              Experience search fallback
```
