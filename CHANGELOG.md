# FlexeTravels Changelog

## [v0.9.0] — 2026-04-14

### Architecture: Side-Channel Card Streaming
- **Side-channel data push** — flight/hotel card data now streams directly to the frontend via AI SDK data stream, completely bypassing LLM token generation for card content. Cards render at ~8-10s instead of ~30s.
- System prompt updated: Claude now writes short commentary only (no more `[FLIGHT_CARD]`/`[HOTEL_CARD]` JSON tags in the LLM output). Tags are assembled server-side from tool results and pushed via the data channel.

### Performance
- Destination guide (Gemini) timeout reduced from 12s to 6s
- Guide fetch is now optional for direct bookings — no longer blocks the response

### Bug Fixes
| Fix | Detail |
|-----|--------|
| **Flight duration display** | ISO 8601 durations like `P1DT50M` now correctly display as "24h 50m" instead of raw string |
| **Card layout shift** | Cards now render after summary text completes — no more mid-stream flickering |
| **Side-channel card persistence** | Cards no longer disappear when message ID changes post-streaming (stable key strategy) |
| **handleSubmit Server Action** | Fixed React 19 compatibility bug where `handleSubmit` was being used as a Server Action incorrectly |

### Content Audit
- Removed all Amadeus, Grok, and Gemini references from public-facing pages
- Phone number moved to Contact page only — removed from all footers
- Contact page created with phone number, email (`support@flexetravels.com`), address, and business hours
- Contact link added to footer navigation across all pages
- Sitewide email changed from personal address to `support@flexetravels.com`

> ⚠️ **NOTE: Payment/checkout flow has NOT been tested after the side-channel architecture change.**
> Card selection → checkout → Stripe payment flow needs end-to-end verification before going to production.

---

## [Unreleased] — 2026-04-14

### Added

#### Passport / Travel Document Collection
- Added passport fields to the **Passengers** step of the checkout flow (Step 2 of 4)
- Collected per-passenger for both adults and children when a flight is in the cart:
  - **Passport Number** — free-text, auto-uppercased
  - **Issuing Country** — dropdown of ~55 countries (ISO 3166-1 alpha-2)
  - **Expiry Date** — Year / Month / Day dropdowns (current year → +10 years), same accessible pattern as the DOB picker
- Passport section only appears when a flight is selected (not required for hotel-only bookings)
- Country dropdown expanded from 20 to 55 countries and shared between the nationality selector and passport issuing country field
- Validation on form submission:
  - All three passport fields required per passenger (when booking a flight)
  - Expiry date must be in the future (expired passport blocked with a clear error message)
- Invoice step (Step 3) now displays passport number, issuing country, and expiry date alongside each passenger's details for final verification before payment
- `⚡ Fill test data` (dev mode) pre-fills realistic passport numbers and expiry dates
- Backend: passport data flows through the full booking stack:
  - `CheckoutCard` → `POST /api/book-trip` → `bookingAgent` → Duffel order creation
  - Duffel passenger objects now include a `documents` array with `{ type: 'passport', unique_identifier, expires_on, issuing_country_code, nationality_country_code }` when passport data is present
  - Optional on the API schema — bookings without passport data (sandbox, hotel-only) continue to work

---

### Payment Architecture

FlexeTravels uses a **payment-first** booking flow:

1. **Stripe** charges the full amount (flight fare + $20 service fee) **before** any flight or hotel is booked via external APIs. This protects against abandoned sessions or payment failures after real bookings are made.
2. **Duffel (Flights)** — bookings are settled against the FlexeTravels Duffel account balance (`payment.type: 'balance'`). The balance is funded from the Stripe charge. Not using Duffel Payments (their hosted checkout) — we collect payment via Stripe instead.
3. **LiteAPI (Hotels)** — two modes:
   - **Sandbox**: server-side `ACC_CREDIT_CARD` flow — prebook → book without a real card charge
   - **Production**: LiteAPI User Payment SDK — a hosted Stripe-powered widget loads at `/booking` after the flight is confirmed. The customer pays the hotel cost directly through the widget; FlexeTravels never touches hotel card data. `/api/complete-hotel-booking` is called after the widget fires `onPaymentComplete`.

---

### Bug Fixes (Previous Releases)

| Fix | Detail |
|-----|--------|
| **Hotel search timeout** | LiteAPI hotel search was blocking the AI response for 40+ seconds. Added an 8s wall-clock cap in the aggregator; results now stream back to the user in ~15s. |
| **Currency mismatch on invoice** | Invoice step showed flight price in CAD but Stripe charged in USD. Fixed: all amounts use the Duffel offer currency consistently. |
| **DOB Picker circular-reset bug** | Selecting Year while Month/Day were empty called `onChange('')` → parent cleared state → dropdown reset to empty immediately. Fixed by using independent local state per field; parent is notified only when all three fields are complete. |
| **"Book Now" CTA not navigating** | The Book Now button in the chat UI was not navigating to `/booking` in some cases after hotel selection. Fixed: `handleProceedToBooking` now always writes `ft_cart` and navigates. |
| **LiteAPI 4002 "invalid occupancy number"** | Was sending all passengers with the same `occupancyNumber`. Fixed: one lead guest per room, `occupancyNumber` is 1-indexed room number. |
| **Duffel offer auto-refresh on 422** | Expired Duffel offer IDs (stale after ~15 min) now auto-refresh server-side on first 422, with a price-change guard (±$1.00 tolerance) before retrying the order. |
| **Expandable flight details on checkout** | Segment-by-segment flight details toggle (ChevronDown/Up) was not working on the checkout review step. Fixed with per-flight `useState`. |
| **Unaccompanied minor check** | Added validation: children under 15 without any adult passenger are blocked with a clear error message. |

---

### Deployment

- **Hosting:** Railway (auto-deploys on push to `origin main`)
- **Live URL:** https://www.flexetravels.com
- **Stack:** Next.js 15 App Router · TypeScript · Tailwind CSS · Vercel AI SDK
- **AI Model:** `claude-sonnet-4-6`
- **Flight provider:** Duffel (switch `DUFFEL_ACCESS_TOKEN` from `duffel_test_*` to `duffel_live_*` for production)
- **Hotel provider:** LiteAPI (switch `LITEAPI_KEY` from `sand_*` to `prod_*` for production; set `NEXT_PUBLIC_LITEAPI_SANDBOX=false`)
- **Payment:** Stripe (switch to `sk_live_*` / `pk_live_*` for production; register new webhook endpoint)
- **Database:** Supabase (PostgREST REST API via service_role key)

### Going Live Checklist
1. Fund Duffel account ($500+) → get `duffel_live_*` token → update Railway env
2. Request LiteAPI `prod_*` key → update Railway → set `NEXT_PUBLIC_LITEAPI_SANDBOX=false`
3. Activate Stripe live mode → copy `sk_live_*` + `pk_live_*` → update Railway → register webhook at `https://www.flexetravels.com/api/webhooks/stripe`
4. Verify `/api/health` returns `{"ok":true,"db":true}`
