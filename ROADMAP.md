# FlexeTravels — Roadmap (as of 2026-05-05)

> What's next, ranked by impact / effort. Pair with `STATUS.md` (what's done) and `CLAUDE.md` (current architecture).

## Highest impact / lowest effort

### 0.1 Post-freeze production rollout checklist
The v2 Trip Canvas freeze is ready for Railway deploy. Keep this checklist short and operational:
- Push the freeze commit to `origin/main`; Railway should auto-deploy.
- Confirm Railway env vars are production values: Duffel live, LiteAPI prod, Stripe live, Supabase service role, Anthropic, Gemini/Google Places, Unsplash, Mapbox, SMTP, `NEXT_PUBLIC_TRIP_CANVAS=true`.
- Run Supabase migrations in production: `schema.sql`, `schema-canvas.sql`, `schema-payments.sql`, then `schema-analytics.sql`.
- In Stripe Dashboard, confirm the live webhook points to `https://www.flexetravels.com/api/webhooks/stripe` and uses the matching `STRIPE_WEBHOOK_SECRET`.
- Run a live smoke after deploy: homepage → `/trip` → create canvas → add/flexible-date flight search → passport transit filter → hotel detail → checkout review/invoice. Do not book until final operator approval.
- Rollback path: redeploy the freeze commit/tag or the previous known-good Railway deployment.

### 0. Payment router + ledger hardening (in progress)
The checkout now needs to support multiple money rails: Stripe + Duffel Balance for Canadian merchant-of-record bookings, Duffel Payments where available, Razorpay for India, and future Amadeus/Travelport supplier rails. See `docs/PAYMENTS.md`.
- **Shipped:** `lib/payments/strategy.ts`, `/api/checkout/quote`, Stripe Balance charge path for fare + transparent service fee, `/api/book-trip` amount/currency verification, `lib/db/schema-payments.sql`, runtime quote consumption/idempotency hooks, `docs/AI-QUERY-TESTS.md`, `docs/END-TO-END-TESTING.md`.
- **Next:** apply the payment + analytics migrations in Supabase, automatic refund workflow, Duffel Balance threshold guard, Duffel Payments component path, Razorpay path.
- **Verifier:** paid quote cannot be tampered with; mixed-currency carts are blocked or split; paid-but-not-booked cases are visible and refundable.

### 1. Real Stripe sandbox booking with prod Duffel + LiteAPI keys (2 hours)
The audit cleared the security posture, but no end-to-end booking has run with prod tokens. Run one cheap, refundable hotel + 1-leg flight to flush out any field-shape gotchas (LiteAPI prod `cancellationPolicies` ordering, Duffel live offer expiry behaviour, real Stripe webhook arrival path). Refund the hotel afterwards.
- **Files touched:** none — operational
- **Verifier:** Stripe Dashboard webhook fires, Supabase `bookings` row written, e-ticket + voucher emails arrive, $20 USD on the card

### 2. Travel document provider integration (1-2 days)
The current passport/transit layer is conservative and source-backed for common risk paths, but production OTA-grade accuracy should come from a licensed document provider.
- **Recommended providers:** Timatic, Sherpa, TravelDoc
- **Files touched:** `lib/search/transitVisa.ts`, `/api/search/flights`, checkout pre-booking validation
- **Verifier:** Indian passport via SEA is blocked without U.S. status; UK/Schengen edge cases return provider-backed pass/warn/block decisions.

### 3. Hotel-thumb 404 telemetry (30 minutes)
We fall back to gradient initials when LiteAPI returns dead photo URLs. Add a quiet `console.warn` (or a `/api/admin/logs` write) tracking how often this happens — if it's a non-trivial % per search, we should escalate with LiteAPI or pre-validate the URLs server-side.
- **Files touched:** `components/canvas/SlotPicker.tsx::HotelThumb`
- **Verifier:** dev console shows warnings on production data; baseline collected for a week

### 4. Make the ambiguous-city autocomplete suggest live (1 day)
`/api/canvas/resolve-airport` already returns up to 10 ranked suggestions. Wire a `<datalist>` (or proper combobox) into `AddLegDialog` so the user sees live suggestions as they type — eliminates the "did I spell it right" friction and removes any remaining edge cases where the silent fallback does the wrong thing.
- **Files touched:** `components/canvas/AddLegDialog.tsx`
- **Verifier:** type "san jo" → dropdown shows `San Jose (SJC)`, `San José Costa Rica (SJO)`, `San Juan (SJU)`

---

## Phase A — "Things to do" per leg ✅ SHIPPED

A.1 + A.2 landed 2026-05-02. See `STATUS.md` for the table. Open follow-up:

- Add Mapbox hotel pin to LegMap when hotel coords exist (`CanvasHotelSelection.lat/lon` not yet captured during pick — small extension to LiteAPI normalization)
- Pre-warm itinerary fetch for the first leg on canvas load so the panel's first open is instant
- Support custom POI add ("add this restaurant a friend recommended" — small text input that calls Places Text Search and inserts into the panel)

## Phase B — Multi-leg checkout ✅ SHIPPED

Phase B (multi-leg cart shape, sequential book loop, multi-leg flight-offer pinning in PI metadata) and Phase B.1 (per-leg success screen with partial-failure recovery) landed 2026-05-02. See `STATUS.md`.

---

## Phase C — Real reviews + ratings ✅ SHIPPED

Real Google Places ratings on hotel cards + detail view, with synthetic baseline fallback. See `STATUS.md`. Soft-fails when `GOOGLE_PLACES_API_KEY` is unset so adding it is a zero-risk env change.

---

## Phase D — India unlock (separate workstream, 1 week)

- Razorpay integration (parallel to Stripe — pick provider based on user's geo or explicit toggle)
- INR-native pricing (FX is already there; just need a Razorpay provider in `lib/stripe.ts`)
- WhatsApp Business inbound — diaspora trip planning entry point. Webhook → `/api/whatsapp/inbound` → posts the user's message into a fresh canvas.
- Hindi / Tamil i18n on the canvas (likely Phase D.2 — copy-only)

---

## Phase E — Operational hardening

E.1 (CI + error boundary) shipped 2026-05-02 — see `STATUS.md`. Remaining:

- **Sentry / PostHog SDK wiring.** The `/api/client-error` endpoint + `<ErrorBoundary>` is the placeholder. Once a DSN is provisioned, swap them in (or layer on top — both are compatible with the existing endpoint).
- **Lighthouse passes.** LCP < 2.5 s, CLS < 0.1, perf > 80. The lazy-load + photo cache work has done most of this; need a clean baseline.
- **Soft-launch cookie staging.** `ft_canvas=1` cookie is wired in middleware; use it to opt staff into the canvas for a week before the public flag flip on Railway.

---

## Open questions / decisions to make

1. **Gemini vs Claude for the chat path?** Phase A introduces Gemini for "Things to do." If it goes well, we could A/B Gemini vs Claude on the main canvas command path too (cost ~5–10× cheaper). Worth running a 1-week A/B before committing.
2. **Google Maps vs Mapbox for the per-leg POI map?** Mapbox is already wired and styled. Google Maps integrates more naturally with Places. My recommendation: stay on Mapbox for visual consistency, use Google Places only for the data.
3. **Show or hide the synthetic guest score?** Right now it shows in the hotel card and detail view. Either kill it until we have real reviews (Phase C) or label it clearly as "based on stars." Showing a synthetic 8.3/10 next to hotels with sparse review data feels dishonest.
4. **Map dynamic photos across language switches.** Wikipedia REST is hit on the English title only. If we ever go i18n, we'd want to fetch from the Wikipedia language matching the user's locale — fine to defer.

---

## What's deliberately NOT on the roadmap

- Switching the booking backend to Google. Google does not sell flight or hotel inventory; their travel APIs are ad-tier. Duffel + LiteAPI are correct.
- Replacing Mapbox with a self-hosted map. Cost at our scale is $0; the engineering time isn't recoverable.
- Building an in-house image library to replace Wikipedia + Unsplash. Both are free, real photos for any city, and the OpenSearch fallback solves the disambig case.
- Imagen / DALL-E generated destination photos. Generated images of real cities undermine the "real travel" trust we've built; the providers we use return real photos.
- AI-generated reviews. Too high a regulatory + trust risk for a booking platform.
