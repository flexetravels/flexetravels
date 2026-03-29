# FlexeTravels — Claude Code Steering Document

## What This Is
AI-powered travel booking platform. Users chat with an AI concierge that searches real flights (Duffel) and hotels (LiteAPI), then books them end-to-end. Flat $20 service fee charged via Stripe.

**Live URL:** https://www.flexetravels.com
**GitHub:** flexetravels/flexetravels-next (branch: `master`)
**Hosting:** Railway (auto-deploys on push to `master`)
**Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Vercel AI SDK

---

## Architecture

```
app/
  page.tsx              — Homepage (destinations, discover feed, social proof)
  chat/page.tsx         — AI chat interface
  booking/page.tsx      — Checkout + confirmation (multi-view based on ?ref= param)
  error.tsx             — Travel-themed error boundary
  not-found.tsx         — Travel-themed 404
  api/
    chat/route.ts       — Main AI endpoint (Claude claude-sonnet-4-6, streamText)
    book-flight/        — Duffel order creation
    book-hotel/         — LiteAPI prebook + book
    complete-hotel-booking/ — LiteAPI 3DS completion
    stripe/checkout/    — Creates $20 Stripe Payment Intent
    webhooks/stripe/    — Stripe webhook handler (persists to Supabase)
    health/             — GET /api/health — DB + env check
    admin/stats/        — Growth analytics (requires ?secret=ADMIN_SECRET)
    debug/liteapi/      — Hotel search debugger (requires ?secret=ADMIN_SECRET)

components/
  ChatMessage.tsx       — Parses [FLIGHT_CARD] / [HOTEL_CARD] / [EXPERIENCE_CARD] tags → React cards
  FlightCard.tsx        — Boarding-pass style. isBestValue prop shows "Best value" badge
  HotelCard.tsx         — Hotel card. isBestDeal prop shows "Best deal" badge
  CheckoutCard.tsx      — 3-step checkout: Review → Passengers → Stripe payment
  FlexibilityBadge.tsx  — Refundable / Changeable / Locked badge

lib/
  search/
    duffel.ts           — Duffel flight search (15s timeout)
    liteapi.ts          — LiteAPI hotel search + prebook + book
    aggregator.ts       — Runs providers in parallel, 16s wall-clock cap on flights
  db/
    client.ts           — Supabase REST client (zero extra packages)
    schema.sql          — Full DB schema — paste into Supabase SQL Editor to run
  scoring/
    flexibility.ts      — Scores Duffel fare conditions → Flexible/Moderate/Locked
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
- $20 service fee Payment Intent via Stripe Elements (embedded, not redirect)
- Webhook: `POST /api/webhooks/stripe` — handles `checkout.session.completed` + `payment_intent.succeeded`
- Webhook URL registered in Stripe Dashboard: `https://www.flexetravels.com/api/webhooks/stripe`
- Env vars: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

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
```

---

## AI Chat Flow

1. User sends message → `POST /api/chat`
2. Claude calls tools: `searchFlights`, `searchHotels`, `getDestinationGuide`, `getExperiences`
3. Tools run in parallel (aggregator), results streamed back
4. Claude emits `[FLIGHT_CARD]...[/FLIGHT_CARD]` and `[HOTEL_CARD]...[/HOTEL_CARD]` tags
5. `ChatMessage.tsx` parses tags → renders React cards
6. User selects flight → `[FLIGHT_CHOSEN]` state → AI says one excited sentence + "scroll up"
7. User selects hotel → `[HOTEL_CHOSEN]` state → cart saved to `sessionStorage` as `ft_cart`
8. Frontend navigates to `/booking` → `CheckoutCard` handles 3-step checkout

### System Prompt Rules (enforced)
- NEVER fabricate flight IDs, hotel IDs, prices, or booking tokens
- ALWAYS copy ALL fields exactly from tool results into card tags
- Show top 3 flights + top 3 hotels max
- After flight chosen: ONE sentence only, then stop (no hotel re-listing)
- After hotel chosen: redirect to checkout, no more tool calls

---

## Checkout Flow

1. **Step 1 — Review:** Shows flight + hotel summary, itemized cost (flight + hotel + $20 fee = total)
2. **Step 2 — Passengers:** One form per adult + child (name, DOB, email, phone)
3. **Step 3 — Payment:**
   - Calls `POST /api/book-flight` → Duffel order created
   - Calls `POST /api/book-hotel` → LiteAPI prebook + book
   - Calls `POST /api/stripe/checkout` → Payment Intent created
   - Stripe Elements mounted → user pays $20
   - On success → `/booking?ref=XXX` → confirmation page with confetti

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
