# FlexeTravels — Codex Steering Document

> **Last refresh:** 2026-05-05 — see `STATUS.md` for what shipped recently and `ROADMAP.md` for what's next.

## What this is

AI-powered travel booking platform. Two interaction modes share one backend:

- **Trip Canvas** (`/trip/[id]`) — visual, manipulable trip artifact. Drag-to-reorder legs, click-to-pick flights/hotels, photo banner per leg, embedded route map, optional Cmd+K command bar that goes to the same AI as the chat. **This is the primary UI when `NEXT_PUBLIC_TRIP_CANVAS=true`.**
- **Chat** (`/chat`) — legacy linear chat UI. Middleware redirects `/chat` → `/trip` when the canvas flag is on; rolls back instantly when off.

Transparent checkout with a flat **$20 USD FlexeTravels service fee**. Payment routing is strategy-based: Canada merchant-of-record checkout can collect verified Duffel flight fare + transparent fee in Stripe, then book from Duffel Balance; supplier-direct modes collect only the fee and disclose supplier/property charges separately.

**Live URL:** https://www.flexetravels.com
**GitHub:** flexetravels/flexetravels-next (branch `main`)
**Hosting:** Railway (auto-deploys on push to `origin main`)
**Stack:** Next.js 15 App Router, TypeScript, Tailwind 3, Vercel AI SDK

---

## Architecture (current)

```
app/
  page.tsx                         — Homepage (destinations + discover feed). Hero CTA points at /trip when flag on.
  chat/page.tsx                    — Linear chat (legacy; middleware-redirected to /trip in canvas mode)
  trip/page.tsx                    — POST /api/trip → redirect to /trip/[id]
  trip/[id]/page.tsx               — Server shell, loads CanvasPage
  trip/layout.tsx                  — Loads Spectral + JetBrains Mono fonts
  booking/page.tsx                 — Checkout + confirmation; reads ft_cart sessionStorage
  privacy/, terms/, contact/       — Legal pages (BC jurisdiction, full subprocessor list)
  api/
    chat/route.ts                  — Codex streaming endpoint (chat mode + side-channel cards)
    trip/route.ts                  — POST creates canvas; GET lists by session
    trip/[id]/route.ts             — GET / PATCH canvas state (ownership by sessionId; ?view=shared = read-only)
    trip/[id]/command/route.ts     — Cmd+K + ChatPanel — Codex tool-uses to mutate canvas
    canvas/photos/route.ts         — Wikipedia hero + Unsplash gallery for any city (24h CDN cache)
    canvas/resolve-airport/route.ts — Live IATA resolver via Duffel /places/suggestions
    search/flights/route.ts        — Wraps lib/search/aggregator → Duffel; returns sandbox flag
    search/hotels/route.ts         — Wraps lib/search/aggregator → LiteAPI; returns sandbox flag
    hotel-detail/route.ts          — LiteAPI hotel detail (description, amenities, photos, coords)
    book-trip/                     — Payment-first end-to-end booking
    checkout/quote/                — Non-mutating payment strategy + quote preview
    stripe/prepare/                — Creates strategy-aware PaymentIntent (fare+fee or fee-only)
    webhooks/stripe/               — HMAC-verified webhook → Supabase
    fx/route.ts                    — frankfurter.app proxy (24h cache + hardcoded fallback)
    health/, admin/stats/, admin/logs/, debug/liteapi/  — ops endpoints (admin secret-gated)

components/
  Nav.tsx                          — Shared header; CTA flips based on TRIP_CANVAS flag
  CheckoutCard.tsx                 — 4-step booking flow; renders Trip total + per-passenger breakdown
  FlightCard.tsx, HotelCard.tsx    — Used by /chat (legacy)
  CurrencyContext.tsx, CurrencyPicker.tsx, FlexibilityBadge.tsx  — Display helpers

components/canvas/                 — Trip Canvas v2
  CanvasPage.tsx                   — Top-level layout, owns state, DndContext, sticky checkout footer
  DayLegBlock.tsx                  — Single leg card: hero + photo strip + flight/hotel slots
  DestinationHero.tsx              — Photo-only hero, IntersectionObserver lazy-load
  PhotoStrip.tsx                   — 6-photo horizontal gallery
  RouteMap.tsx                     — Mapbox GL route map (lazy-loaded; markers tracked via useRef)
  SlotPicker.tsx                   — Right-side sheet for flight/hotel results, with filters + detail view
  TravellersChip.tsx               — Adults / children / per-child age picker (in trip header)
  InterestsSheet.tsx               — One-time "what's your vibe?" picker (12 vibes, max 3)
  AddLegDialog.tsx                 — Modal to add a leg (city + IATA + dates)
  CommandBar.tsx                   — Cmd+K command palette
  ChatPanel.tsx                    — Slide-over chat (history persisted to localStorage)

lib/
  agent/session-state.ts           — In-memory session memory (4h TTL, 2k entries; constraints + selections)
  fx/rates.ts, fx/detect.ts        — Server FX cache + client home-currency detection
  search/aggregator.ts             — Runs flight + hotel providers; in-memory result cache
  search/duffel.ts                 — Duffel offer-request (15s timeout)
  search/liteapi.ts                — LiteAPI search + prebook + book (multi-room aware)
  search/flightCache.ts, hotelCache.ts  — 60-120s LRU cache pattern (template for our other caches)
  scoring/flexibility.ts           — Score Duffel fare conditions → Flexible/Moderate/Locked
  canvas/types.ts                  — CanvasState, CanvasLeg, CanvasFlightSelection, CanvasHotelSelection
  canvas/state.ts                  — Reducer + applyOp/applyOps + computeTotals (OTA savings heuristic)
  canvas/useCanvas.ts              — Client hook: optimistic dispatch + 700ms-debounced PATCH
  canvas/airport-coords.ts         — Static IATA→[lon,lat] table for the route map (NOT used for resolution)
  canvas/airport-resolver.ts       — Live Duffel /places/suggestions wrapper (1h LRU cache)
  canvas/wikipedia-photo.ts        — Wikipedia REST + OpenSearch fallback (24h LRU cache)
  canvas/unsplash-photos.ts        — Wikipedia hero + Unsplash gallery, qualifier-aware query (24h cache)
  canvas/destination-media.ts      — Themed beach/city/mountain fallback photo bundles (no-network path)
  db/client.ts                     — Supabase REST helpers (db.tripsCanvas.{create,get,update,…})
  db/schema.sql, schema-canvas.sql, schema-payments.sql — Full DB + canvas/payment migrations
  payments/strategy.ts             — Payment strategy router + quote math
  stripe.ts                        — PI helpers + HMAC-verified webhook signature

middleware.ts                      — Bot detection, geo-block, burst limiter, 100/min global rate limit, /trip flag gate
next.config.js                     — CSP (X-Frame DENY, HSTS, no wildcards), per-domain connect-src, Stripe whitelist
```

---

## Key providers

### Duffel (flights + airport resolution)
- **Flight search:** `POST /air/offer_requests?return_offers=true` (synchronous; 15 s timeout in `duffel.ts`, 16 s wall-clock cap in `aggregator.ts`).
- **Airport resolution:** `GET /places/suggestions?query=<q>` — replaces hand-curated city → IATA tables. Maps "Halifax" → YHZ, "Cleveland" → CLE, etc.
- Token: `DUFFEL_ACCESS_TOKEN` (`duffel_test_*` for sandbox, `duffel_live_*` for prod).

### LiteAPI (hotels)
- Search: `POST /hotels/rates` → list. Detail: `GET /data/hotel?hotelId=…` → photos, amenities, coordinates, contact, full cancellation policies.
- Prebook → Book sequence. Critical: `occupancyNumber` in book payload is **1-indexed room number, NOT passenger index** — bug fixed March 2026.
- Token: `LITEAPI_KEY` (`sand_*` for sandbox, `prod_*` for prod).

### Stripe (strategy-aware checkout)
- Canada balance mode: PI collects verified Duffel flight fare + transparent FlexeTravels fee, then `/api/book-trip` books with Duffel Balance.
- Supplier-direct mode: PI collects only the FlexeTravels fee; supplier/hotel fare is disclosed separately.
- `/api/book-trip` reads `pi.metadata.expected_amount`, `expected_currency`, and pinned offer IDs; it rejects amount/currency/offer mismatches before touching Duffel/LiteAPI.
- Webhook: HMAC-verified with 5-min timestamp window in `lib/stripe.ts`. URL: `https://www.flexetravels.com/api/webhooks/stripe`.
- Env: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

### Wikipedia + Unsplash (destination photos)
- **Hero:** Wikipedia REST `/api/rest_v1/page/summary/{title}` returns the canonical landmark for any city (Mt. Royal for Montreal, Eiffel for Paris). On disambiguation pages, falls back to Wikipedia OpenSearch (`?action=opensearch`) and tries the ranked candidates until one has a usable photo.
- **Gallery:** Unsplash `/search/photos` with the qualifier from Wikipedia's description ("Montreal Quebec Canada" instead of bare "Montreal" for relevance).
- Both wrapped in `unsplash-photos.ts`, served via `/api/canvas/photos` with `Cache-Control: s-maxage=86400, stale-while-revalidate=86400`.
- Wikipedia: no key, just User-Agent. Unsplash: `UNSPLASH_ACCESS_KEY` (free tier, 5k req/hr).

### Mapbox GL (route map + hotel mini-map)
- Lazy-loaded via `next/dynamic({ ssr: false })` in `CanvasPage.tsx` — saves ~470 kB from initial bundle.
- Mini-map on hotel detail uses **Mapbox Static Images API** (no JS bundle cost — just an `<img>`).
- Token: `NEXT_PUBLIC_MAPBOX_TOKEN`.

### Codex (AI agent)
- Model: `Codex-sonnet-4-6` for both chat and canvas command. `maxSteps: 25` for canvas (multi-leg planning), `maxSteps: 2` for chat.
- Tool surfaces:
  - `searchFlights`, `searchHotels`, `setConstraint`, `clearConstraint` (chat)
  - `setHomeOrigin`, `addLeg`, `removeLeg`, `setTravellers`, `extendStay`, `swapFlight`, `swapHotel`, `respond` (canvas)
- Env: `ANTHROPIC_API_KEY` (also referenced as `FLEXE_ANTHROPIC_KEY` in `chat/route.ts` to allow per-environment override).

### Gemini (text-only destination guides)
- `geminiDestinationGuide()` in `lib/ai/gemini.ts` returns a 150-word travel guide. **Note:** despite the name, this currently calls Codex Haiku (the Gemini SDK was swapped in April 2026). Env var name kept as `GEMINI_API_KEY` for legacy reasons.
- A future Phase A is wiring real Gemini 2.5 with Google Search grounding for "Things to do per leg" — see ROADMAP.md.

---

## Database (Supabase)

REST API via service role key. Tables: `trips`, `bookings`, `events`, `credits`, `payments`, `search_logs`, `user_sessions`, **`trips_canvas`** (the canvas trips).

### `trips_canvas`
```sql
id          UUID PRIMARY KEY,
session_id  TEXT NOT NULL,            -- anonymous session
user_id     UUID,                     -- optional auth user
title       TEXT DEFAULT 'Untitled trip',
origin_city TEXT,
state       JSONB DEFAULT '{}',       -- CanvasState — see lib/canvas/types.ts
status      TEXT,                     -- 'planning' | 'booked' | 'archived'
created_at  TIMESTAMPTZ,
updated_at  TIMESTAMPTZ
```
RLS: `TO service_role USING (true) WITH CHECK (true)`. **Do NOT use `USING (false)`** — that blocks REST writes. Anon role has no policies (denied).

---

## Environment variables (Railway)

```
# Core booking stack
DUFFEL_ACCESS_TOKEN=duffel_live_…
DUFFEL_WEBHOOK_SECRET=…
LITEAPI_KEY=prod_…
STRIPE_SECRET_KEY=sk_live_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…

# Persistence + observability
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ…       (service role — NOT anon)
SUPABASE_ANON_KEY=eyJ…           (optional)

# AI
ANTHROPIC_API_KEY=sk-ant-…
GEMINI_API_KEY=…                 (currently used for the Codex-Haiku destination-guide helper)

# Photos
UNSPLASH_ACCESS_KEY=…
NEXT_PUBLIC_MAPBOX_TOKEN=pk.…

# Flag + URLs
NEXT_PUBLIC_TRIP_CANVAS=true
NEXT_PUBLIC_APP_URL=https://www.flexetravels.com
ADMIN_SECRET=<32+ char random>

# Email
SMTP_HOST=mail.neosite.com
SMTP_PORT=587
SMTP_USER=bookings@flexetravels.com
SMTP_PASS=…
SMTP_FROM=FlexeTravels <bookings@flexetravels.com>
```

---

## Trip Canvas flow (read this if you're touching `/trip`)

1. User lands on `/trip` → POST `/api/trip` → row in `trips_canvas` → redirect to `/trip/<uuid>`.
2. `CanvasPage` mounts → `useCanvas` hook reads initial state → debounce-PATCHes any change.
3. **Vibe sheet** appears once (when `meta.createdFrom === 'new'` and no interests yet). Selection is persisted to `state.meta.interests` and injected into Codex's system prompt for biased picks.
4. **Add leg** via dialog (`AddLegDialog`) or AI command. Each leg has its own card with:
   - Hero photo from `/api/canvas/photos?city=…` (Wikipedia + Unsplash, lazy-loaded via IntersectionObserver)
   - 6-photo gallery strip
   - Flight + hotel slots that open `SlotPicker` (right sheet)
5. **Reorder** via @dnd-kit/sortable: PointerSensor with 6 px activation distance (so button clicks still work), TouchSensor with 250 ms long-press, KeyboardSensor for a11y.
6. **Pick flight/hotel** in SlotPicker → `set_flight` / `set_hotel` op → renders docked card. Each pick stamps `pricedFor: { adults, children, childAges }` so the leg shows an amber "travellers changed — re-search" banner if the mix changes after picking.
7. **Sticky checkout strip** sums everything + service fee. CTA → `handleCheckout()` writes `ft_cart` sessionStorage in the same shape `/chat` writes → `/booking` reads it.
8. **Share view** (`?view=shared`) returns sanitized state (no `session_id`/`user_id`), disables every editor, and replaces the checkout CTA with "Plan your own".

### Session memory (chat mode only)
`lib/agent/session-state.ts` holds typed `TripConstraints` per sessionId (4 h TTL, 2 k entries, process-local). Auto-captures filters from each searchFlights/searchHotels call so retries don't drop user preferences.

---

## Checkout flow (CRITICAL — payment-first)

1. **Step 1 Review** — Trip total line shows flight + hotel + $20 fee in one currency when they match; explicit "charged today" / "charged by airline / by hotel" note.
2. **Step 2 Passengers** — One form per adult + child. Children pricing uses `cart.children.{count, ages}` shape (canvas writes this; legacy `/chat` already wrote it).
3. **Step 3 Invoice** — Strategy-aware breakdown. Canada balance mode shows flight fare + FlexeTravels fee charged now by FlexeTravels and Tours Inc.; supplier-direct mode shows fee now and supplier fare separately.
4. **Step 4 Pay**
   - `POST /api/stripe/prepare` → PI created for the selected strategy.
   - Stripe Elements → user pays the disclosed amount.
   - `POST /api/book-trip` with `paymentIntentId`.
   - Server fetches PI from Stripe, verifies `status === 'succeeded'`, expected amount/currency, and pinned offer IDs.
   - **Only then** Duffel order + LiteAPI prebook+book fire. In Canada balance mode, FlexeTravels pays Duffel from Balance.

---

## Security posture (audited 2026-05-02)

All 14 critical checks PASS — see `STATUS.md` for the audit table. Highlights:
- No `NEXT_PUBLIC_*` exposes a server secret.
- `/api/webhooks/stripe` HMAC-verifies + 5 min timestamp window + timing-safe compare.
- `/api/book-trip` payment-first guard: rejects if PI is not succeeded or amount/currency/offer metadata does not match.
- Middleware: 100 req/min global + 3/min on `/api/book-trip` + 5/min on `/api/stripe/prepare`.
- Admin endpoints require `x-admin-secret` HEADER (timing-safe), never query param.
- CSP: no wildcards in `connect-src`, X-Frame-Options DENY, HSTS, strict referrer policy.

---

## Common issues & fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Stale map markers after reorder/remove | RouteMap stored markers on closure-local property | Use `useRef<Marker[]>` across renders. Fixed 2026-05-02. |
| Hotel image renders as blank navy square | `<div bg-image url(broken)>` has no failure fallback | Use `<img onError>` to fall back to gradient initials. Fixed 2026-05-02. |
| "Montreal" → MON instead of YUL | Local `toIata` silently sliced first 3 letters | Resolver returns null on miss; SlotPicker surfaces a clear error AND falls back to Duffel `/places/suggestions`. Fixed 2026-05-01. |
| "Halifax" not in our hardcoded city map | `CITY_TO_IATA` was a curated list | Live Duffel resolver. Fixed 2026-05-02. |
| Wikipedia returns disambiguation page | "Halifax" alone is ambiguous | OpenSearch fallback fetches ranked candidates, picks first with photo. Fixed 2026-05-02. |
| Sandbox banner sticks after key swap | Banner reads `process.env.DUFFEL_ACCESS_TOKEN` server-side | Restart dev server after editing `.env.local`. |
| LiteAPI 4002 invalid occupancy | Sent all guests to same room | One lead guest per room (`occupancyNumber` is 1-indexed room) |
| Stripe charges €1,220 for €1,200 flight | Flight + $20 summed in one PI | PI is ALWAYS $20 USD; never reintroduce cross-currency addition |
| `[DB] POST search_logs failed 401` | RLS `USING (false)` | Use `TO service_role USING (true)` |

---

## Dev commands

```bash
npm run dev                    # localhost:3000
NEXT_PUBLIC_TRIP_CANVAS=true npm run dev   # canvas mode

npx tsc --noEmit               # type-check (don't trust lint alone)
npx next build                 # production sanity
npx playwright test            # 24-test e2e suite (uses port 3920, single worker)
npx playwright test e2e/flow.spec.ts                       # exhaustive flow + visual screenshots
npx playwright test --ui                                   # UI mode for stepping through
```

E2E artifacts live in `e2e/.results/` — every flow run drops 10 screenshots there for visual review.

---

## What this plan deliberately does NOT do

- Does not switch booking from Duffel/LiteAPI — Google doesn't sell flight/hotel inventory; current providers are correct.
- Does not replace Codex with Gemini — they're comparable; cost (Gemini cheaper) vs reliability (Codex more consistent on chained tool calls). Run an A/B before committing.
- Does not hide markup in fares — the FlexeTravels fee remains explicit even when collected with a supplier fare.

For features that ARE planned, see `ROADMAP.md`.
