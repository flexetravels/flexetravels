# FlexeTravels — Claude Code Steering Document

## What This Is
AI-powered travel booking platform. Users chat with an AI concierge that searches real flights (Duffel) and hotels (LiteAPI), then books them end-to-end. Flat $20 service fee charged via Stripe.

**Live URL:** https://www.flexetravels.com
**GitHub:** flexetravels/flexetravels-next (branch: `main`)
**Hosting:** Railway (auto-deploys on push to `origin main`)
**Deploy command:** `git push origin main`
**Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Vercel AI SDK

---

## Architecture

```
app/
  page.tsx              — Homepage (destinations, discover feed, social proof)
  chat/page.tsx         — AI chat interface (wires side-channel data → cards)
  booking/page.tsx      — Checkout + confirmation (multi-view based on ?ref= param)
  error.tsx             — Travel-themed error boundary
  not-found.tsx         — Travel-themed 404
  layout.tsx            — Wraps children in ThemeProvider + CurrencyProvider
  api/
    chat/route.ts       — Main AI endpoint (Claude claude-sonnet-4-6, streamText).
                          Injects session memory constraints + registers trip-memory
                          tools (setConstraint / clearConstraint) alongside search tools.
    book-flight/        — Duffel order creation
    book-hotel/         — LiteAPI prebook + book
    book-trip/          — Payment-gated end-to-end booking (verifies Stripe PI → books)
    complete-hotel-booking/ — LiteAPI 3DS completion
    fx/route.ts         — USD→* daily FX rates (proxies frankfurter.app, 24h cache)
    stripe/checkout/    — Creates $20 Stripe Checkout Session (redirect flow — legacy)
    stripe/prepare/     — Creates $20 USD Stripe PaymentIntent (service fee only)
    webhooks/stripe/    — Stripe webhook handler (persists to Supabase)
    health/             — GET /api/health — DB + env check
    admin/stats/        — Growth analytics (requires ?secret=ADMIN_SECRET)
    admin/logs/         — Recent app/search logs (requires ?secret=ADMIN_SECRET)
    debug/liteapi/      — Hotel search debugger (requires ?secret=ADMIN_SECRET)

components/
  ChatMessage.tsx       — Parses [FLIGHT_CARD] / [HOTEL_CARD] / [EXPERIENCE_CARD]
                          tags → React cards. Renders one labeled flight carousel
                          per leg when searchFlights is called more than once in a turn.
  FlightCard.tsx        — Boarding-pass style. Renders N-leg itineraries
                          (outbound, return, or multi-city Leg N · A → B). Shows
                          home-currency conversion next to the USD price and inside
                          each fare-variant tab. "Best value" badge via isBestValue.
  HotelCard.tsx         — Hotel card. isBestDeal prop shows "Best deal" badge.
                          Dual-currency display on per-night + total price.
  CheckoutCard.tsx      — 4-step checkout: Review → Passengers → Invoice → Pay.
                          $20 USD service fee charged via Stripe; flight fare
                          charged separately by airline (Duffel). Displays both
                          legs in their own currency with ~home-currency conversion.
  CurrencyContext.tsx   — React provider + useCurrency() hook. Detects navigator.language
                          → ISO-4217 on first load, persists picker choice in localStorage.
  CurrencyPicker.tsx    — Header dropdown (USD/CAD/INR/EUR/GBP/…) for display currency.
  FlexibilityBadge.tsx  — Free-cancellation / Changeable / Non-refundable pill.

lib/
  agent/
    session-state.ts    — In-memory per-session Map<sessionId, SessionState>.
                          Holds typed TripConstraints (avoidAirlines, cabinClass,
                          hotelStars, …) + chosen flight/hotel snapshots. Tool
                          executors in /api/chat merge this into search params so
                          filters survive retries and message-history compression.
                          4h TTL, 2000-entry cap, process-local (swap for Redis
                          if we ever scale beyond one Railway replica).
  fx/
    rates.ts            — Server-side FX rate cache (frankfurter.app, 24h TTL,
                          hard-coded fallback snapshot). Served via /api/fx.
    detect.ts           — Client helper: navigator.language → ISO-4217 currency,
                          localStorage override.
  search/
    duffel.ts           — Duffel flight search (15s timeout). Supports N-slice
                          multi-city via params.slices; builds NormalizedFlight.legs[]
                          from every offer slice.
    liteapi.ts          — LiteAPI hotel search + prebook + book
    aggregator.ts       — Runs providers in parallel, 16s wall-clock cap on flights
    flightCache.ts      — 60s in-process cache keyed on origin/destination/dates
                          (+ slice chain for multi-city)
    hotelCache.ts       — 60s in-process hotel cache
  db/
    client.ts           — Supabase REST client (zero extra packages)
    schema.sql          — Full DB schema — paste into Supabase SQL Editor to run
  scoring/
    flexibility.ts      — Scores Duffel fare conditions → Flexible/Moderate/Locked
  utils.ts              — formatPrice, formatMoneyDual (dual-currency display),
                          convertAmount, compressMessageHistory, parseEmbeddedCards
  stripe.ts             — Stripe Payment Intent creation
```

---

## Key Providers

### Duffel (Flights)
- Endpoint: `POST /air/offer_requests?return_offers=true` — synchronous, real-time
- Timeout: 15s hard cap in `duffel.ts`, 16s wall-clock cap in `aggregator.ts`
- Returns top 10 sorted by price, AI shows top 3
- Token env var: `DUFFEL_ACCESS_TOKEN` (`duffel_test_*` for sandbox, `duffel_live_*` for prod)

### LiteAPI (Hotels)
- Search: `POST /hotels/rates` — returns rooms + rates
- Prebook: `POST /rates/prebook` — locks rate, returns `prebookId`
- Book: `POST /rates/book` — requires `guests` array with **one lead guest per room**
  - Critical: `occupancyNumber` is 1-indexed room number, NOT passenger index
  - Bug fixed: was sending all passengers with same occupancyNumber → 4002 error
- Token env var: `LITEAPI_KEY` (`sand_*` for sandbox, `prod_*` for prod)

### Stripe
- **$20 USD flat service fee only.** The flight fare is charged separately by
  the airline (Duffel) at order-creation time in the airline's native currency.
  The PaymentIntent is ALWAYS created for `2000` cents in `usd` regardless of
  the flight currency.
- `/api/stripe/prepare` verifies the flight offer price with Duffel (for
  transparency + receipt wording) but never adds it to the PI amount.
- `/api/book-trip` verifies `pi.amount === expected_amount` from metadata
  before touching Duffel/LiteAPI — tampering resistance.
- Historical bug fixed (April 2026): the PI used to be `flightCents +
  SERVICE_FEE_CENTS` in the flight's currency. For a €1,200 flight this
  produced a €1,220 charge instead of the intended $20. **Do not reintroduce
  any cross-currency addition in prepare/route.ts or checkout UI.**
- Webhook: `POST /api/webhooks/stripe` — handles `checkout.session.completed` + `payment_intent.succeeded`
- Webhook URL registered in Stripe Dashboard: `https://www.flexetravels.com/api/webhooks/stripe`
- Env vars: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

### FX (currency display)
- Source: `https://api.frankfurter.app/latest?from=USD` — free, no API key, ECB daily rates
- Server cache: 24h in-process, plus a hard-coded fallback snapshot in
  `lib/fx/rates.ts` so the UI never hard-fails for want of rates
- Client fetches once per session from `/api/fx`, held in `CurrencyContext`
- Used ONLY for display (e.g. "$61 USD · ~CA$84" on a flight card). Stripe
  still charges in the real currency; airlines settle in their currency.
- Default home currency detection: `navigator.language` → ISO-4217 (en-CA→CAD,
  en-IN→INR, etc.), overridable via `<CurrencyPicker />` in the chat header
  (value persisted in localStorage as `ft_home_currency`).

### Claude (AI)
- Model: `claude-sonnet-4-6`
- `maxTokens: 2500`, `maxSteps: 2` (prevents multi-round back-and-forth)
- System prompt in `app/api/chat/route.ts` → `buildSystem()`
- Tool results injected as user messages to avoid token bloat
- Message compression: keeps last 6 messages

---

## Database (Supabase)

**Connection:** PostgREST REST API via service_role key
**Tables:** `trips`, `bookings`, `events`, `credits`, `payments`, `search_logs`, `user_sessions`

### RLS Policy — IMPORTANT
All tables use `TO service_role USING (true) WITH CHECK (true)`.
**Do NOT use `USING (false)`** — that blocks the service_role via PostgREST REST API.
The anon/public role has no policies → denied by default.

### To run schema from scratch
1. Supabase → SQL Editor → New query
2. Paste `lib/db/schema.sql` → Run
3. Safe to re-run (uses `CREATE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`, `DROP POLICY IF EXISTS`)

### DB env vars
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   ← service_role key (NOT anon key)
SUPABASE_ANON_KEY=eyJ...      ← anon key (optional)
```

---

## Railway Environment Variables

All required vars (must be set in Railway Dashboard → service → Variables):

```
ANTHROPIC_API_KEY=sk-ant-...
DUFFEL_ACCESS_TOKEN=duffel_test_...     ← switch to duffel_live_ for prod
DUFFEL_WEBHOOK_SECRET=...
LITEAPI_KEY=sand_...                    ← switch to prod_ for prod
STRIPE_SECRET_KEY=sk_test_...           ← switch to sk_live_ for prod
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...         ← from Stripe Dashboard → Webhooks
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://www.flexetravels.com
ADMIN_SECRET=<strong random string>
GEMINI_API_KEY=...                      ← for destination guides
# ── Neomail / SMTP — Confirmation emails ───────────────────────
SMTP_HOST=mail.neosite.com              ← Neomail SMTP host (check Neomail settings)
SMTP_PORT=587                           ← 587 (STARTTLS) or 465 (SSL)
SMTP_USER=bookings@flexetravels.com     ← Neomail email address
SMTP_PASS=...                           ← Neomail email password
SMTP_FROM=FlexeTravels <bookings@flexetravels.com>
```

---

## AI Chat Flow

1. User sends message → `POST /api/chat`
2. Chat route looks up `SessionState` for the sessionId, injects `ACTIVE TRIP
   CONSTRAINTS` into the system prompt when non-empty
3. Claude calls tools: `searchFlights`, `searchHotels`, `getDestinationGuide`,
   `getExperiences`, `setConstraint`, `clearConstraint`
4. **Cards are pushed via side channel**, not emitted as token tags (legacy
   `[FLIGHT_CARD]` / `[HOTEL_CARD]` emission is obsolete — tool execute()
   writes the full data to `dataStream.writeData({type:'flights',route,data})`
   with a `route` metadata payload so the client can label each carousel).
5. `searchFlights.execute()` merges session-memory constraints into any
   undefined filter slots before calling Duffel, then captures the effective
   filter set back into memory for future turns.
6. `ChatMessage.tsx` renders one `FlightResultsPanel` per search call — so a
   multi-leg turn ("A→B, then B→C") produces one labeled carousel per leg
   instead of silently overwriting earlier results.
7. User selects flight → `[FLIGHT_CHOSEN]` sent on the next user message →
   `conversationState = 'flight_selected'` → AI says one excited sentence + "scroll up"
8. User selects hotel → `[HOTEL_CHOSEN]` → cart saved to `sessionStorage` as `ft_cart`
9. Frontend navigates to `/booking` → `CheckoutCard` handles 4-step checkout

### Session Memory (agent state)
- `lib/agent/session-state.ts` holds a `Map<sessionId, SessionState>` keyed on
  the sanitized sessionId (4h TTL, 2000-entry cap, process-local)
- `SessionState.constraints` is a typed subset of the searchFlights/searchHotels
  filter fields (avoidAirlines, cabinClass, hotelStars, hotelAmenities, …)
  plus free-form notes (dietary, mobility, notes)
- **Auto-capture**: every searchFlights / searchHotels call extracts its filter
  fields and merges them into constraints after the search. First call of the
  turn establishes the baseline; later calls refine it.
- **Auto-merge**: every searchFlights / searchHotels call merges constraints
  into any undefined slots in its params BEFORE calling the provider. So a
  retry that drops `avoidAirlines` still excludes the blocked airlines.
- **Explicit changes**: the `setConstraint` / `clearConstraint` tools let
  Claude record user preference changes ("actually business class", "Air
  India is fine now") without a search. Auto-capture can't express a
  loosening, so these tools are the escape hatch.
- **Tool params always win.** Memory only fills in undefined fields; an
  explicit `avoidAirlines: []` overrides memory.
- **Zero DB writes in the hot path.** If the Node process restarts, sessions
  reset (in-flight bookings are already persisted via `/api/book-trip`).

### System Prompt Rules (enforced)
- NEVER fabricate flight IDs, hotel IDs, prices, or booking tokens
- Cards are now pushed via side channel — **do NOT emit `[FLIGHT_CARD]` or
  `[HOTEL_CARD]` tags** (they waste tokens; the UI auto-renders from the
  stream)
- Show top 3 flights + top 3 hotels max in summary prose
- **Multi-city (3+ destinations in one ticket)**: pass `slices=` to
  searchFlights instead of origin/destination
- **Stay-between-legs itineraries ("A → B, stay 2 nights, B → C")**: these
  are TWO one-way tickets. Call searchFlights twice, once per leg. Duffel
  returns 0 for a multi-city with gap days.
- **Preserve filters on retry**: if you retry searchFlights after a
  correction (IATA typo, date adjustment), carry over every user filter
  the first call had. Session memory does this automatically now, but
  don't rely on it — still include the filters explicitly.
- After flight chosen: ONE sentence only, then stop (no hotel re-listing)
- After hotel chosen: redirect to checkout, no more tool calls

---

## Checkout Flow (Payment-First — CRITICAL)

**Order:** Stripe $20 USD service fee is charged BEFORE any flight or hotel is
booked. This prevents real Duffel/LiteAPI bookings from firing if the user
abandons or payment fails. **The flight fare is charged separately by the
airline (via Duffel), not through Stripe** — never sum them into one PI.

1. **Step 1 — Review:** Trip summary, passenger count controls. Each price line
   shows charge currency plus a bold teal ~home-currency conversion.
2. **Step 2 — Passengers:** One form per adult + child (name, DOB, email, phone)
3. **Step 3 — Invoice:** Two separate breakdown sections:
   - "Charged to your card now" — ONLY the $20 USD service fee
   - "Flight fare — charged by airline" — informational, in the airline's
     native currency, with a note that the bank may apply a small FX fee
4. **Step 4 — Pay:**
   - `POST /api/stripe/prepare` → creates a $20 USD PaymentIntent (ALWAYS USD,
     ALWAYS $20). Returns `clientSecret` + `paymentIntentId`.
   - Stripe Elements mounted → user enters card → pays $20 USD.
   - On `confirmPayment` success → `POST /api/book-trip` with `paymentIntentId`.
   - Server verifies PI `status === 'succeeded'` + `amount === 2000` via
     Stripe API before any booking API calls.
   - Duffel flight order created (airline charges its fare directly to the
     same card in its native currency at this step), LiteAPI hotel prebook + book.
   - Success screen shows flight ref + hotel ref.

### Server-side payment guard (`/api/book-trip`)
- If `STRIPE_SECRET_KEY` is set → `paymentIntentId` is **required**
- Calls `GET /v1/payment_intents/:id` — rejects with 402 if status ≠ `succeeded`
- Verifies `pi.amount === metadata.expected_amount` to detect tampering
- Dev/sandbox: if no Stripe key, PI verification is skipped with a warning log

---

## Performance Notes

- Duffel search: real-time pricing, typically 8-15s. Hard timeout at 15s in `duffel.ts`.
- Aggregator wall-clock cap: 16s for flights, 8s for experiences
- Destination guide (Gemini): 12s timeout cap
- Claude response streaming: user sees first content ~5-10s in, stream closes ~30-40s total
- `maxSteps: 2` prevents Claude from doing multiple tool-call rounds

---

## Debugging

### Check if DB is working
```
GET https://www.flexetravels.com/api/health
```
Should return `{"ok":true,"db":true,...}`

### Check hotel availability for a destination
```
GET https://www.flexetravels.com/api/debug/liteapi?dest=Cancun&secret=YOUR_ADMIN_SECRET
```

### Check growth analytics
```
GET https://www.flexetravels.com/api/admin/stats?secret=YOUR_ADMIN_SECRET
```

### Railway logs
Railway Dashboard → your service → Deployments → click build → View logs
Look for `[DB] DB_AVAILABLE:` on startup to confirm Supabase is connected.

---

## Going Live (Production Key Switch)

1. **Duffel:** Fund account ($500+) → get `duffel_live_*` token → update Railway
2. **LiteAPI:** Request `prod_*` key → update Railway → set `NEXT_PUBLIC_LITEAPI_SANDBOX=false`
3. **Stripe:** Activate live mode → copy `sk_live_*` + `pk_live_*` → update Railway → register new webhook endpoint in Stripe live dashboard
4. **Test card (sandbox only):** `4242 4242 4242 4242` / `12/29` / `123`

---

## Verified Bookable Destinations (Sandbox)

These have been confirmed end-to-end in sandbox (flights + hotels):
- Cancún, Mexico (from Toronto YYZ) ✓
- Dubai, UAE (from Vancouver YVR) — flights ✓, hotels sparse in sandbox
- New York City (from Toronto YYZ) ✓
- Punta Cana, Dominican Republic ✓

---

## Known Sandbox Limitations

- **LiteAPI sandbox** has limited hotel inventory — some destinations return 0 hotels
- **Duffel sandbox** returns real-looking but fake flight data
- **Stripe sandbox** — use test card `4242 4242 4242 4242`
- DB writes were silently failing until RLS policies were fixed (March 2026)

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| LiteAPI 4002 "invalid occupancy number" | Sending all passengers to same room | One lead guest per room in `guests[]` array |
| `[DB] POST search_logs failed 401` | RLS policy `USING (false)` blocking service_role | Use `TO service_role USING (true)` |
| Stripe payment form not appearing | Missing `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Add to Railway env vars |
| Hotel booking "prebook expired" | LiteAPI prebookId TTL is ~5 min (sandbox) | User must complete checkout within 5 min |
| Search taking 40s+ | Duffel real-time pricing + Claude generation | Duffel capped at 15s, Claude at 2500 tokens |
| `NEXT_PUBLIC_APP_URL not set` | Missing env var | Set to `https://www.flexetravels.com` |
| Stripe charges wrong amount (e.g. €1,220 for €1,200 flight) | Flight price + $20 summed in one PI | Fixed April 2026 — PI is ALWAYS $20 USD; airline charges fare separately. Don't reintroduce cross-currency addition. |
| User's "avoid Air India" ignored after a retry | Claude dropped `avoidAirlines` on retry call | Fixed April 2026 — session memory auto-merges filters from prior calls in `lib/agent/session-state.ts`. |
| Only one flight carousel shown when AI searched multiple legs | Side-channel `pendingFlightsRef` overwrote on each result | Fixed April 2026 — client accumulates into `pendingFlightGroupsRef`, renders one labeled panel per `route.label`. |
| Converted price invisible on fare-variant tabs | Conversion only rendered on main price row | Fixed April 2026 — `formatMoneyDual` rendered inside each variant tab in bold teal. |
| `/api/fx` returns stale rates | Upstream (frankfurter.app) unreachable | Expected — `lib/fx/rates.ts` serves a hard-coded snapshot with `stale: true`. UI still renders, rates are approximate. |
