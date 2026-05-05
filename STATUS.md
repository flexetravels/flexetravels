# FlexeTravels — Status (as of 2026-05-05)

> **Freeze / rollback point:** FlexeTravels v2 Trip Canvas production freeze. Commit/tag this snapshot before Railway deploy; rollback by redeploying the freeze commit or tag from GitHub/Railway.

> Phases A.1, A.2, B.1 shipped after the security audit. See "Phase A + B.1" section below.

> Snapshot of what shipped across the v2 build sessions. Pair with `ROADMAP.md` for what's next.

## Vision (one paragraph)

A travel-booking platform that wins on **honesty + manipulability**, not on AI flash. Flat $20 fee, no commission baked into flight/hotel prices. The core differentiator is the **Trip Canvas** — a visual artifact the user owns and edits directly (drag legs, swap a hotel, set traveller mix) AND can mutate via natural language (Cmd+K / Chat). One product, two interaction modes, defensible against Booking.com clones (no AI moat) and against AI-only travel startups (linear chat only).

The v2 cycle's job has been to (1) ship the canvas, (2) make every part of it real-data-driven (no hardcoded guesses), and (3) get it production-secure.

---

## What's done

### Production freeze — v2 Trip Canvas (2026-05-05)

| Item | Status |
|---|---|
| Trip Canvas primary workflow | frozen for Railway deploy — canvas, chat panel, command bar, drag/reorder, share view, checkout handoff |
| Live flight correctness | hardened — Duffel airport resolver, flexible-date flight search, airline/routing filters, no hardcoded city → IATA booking logic |
| Multi-leg checkout | frozen — all selected flights/hotels carried into checkout, per-leg totals, per-leg booking results, multi-leg partial-failure recovery |
| Checkout transparency | hardened — review + invoice repeat flight segments, layovers, operating carrier, cabin, fare flexibility, baggage caveats, passenger allocations |
| Passport / transit filtering | shipped — canvas asks for passport country + held visas/status only, filters known blocked transit routings such as Indian passport via U.S. airports without U.S. status |
| Destination visuals | hardened — live Wikipedia + Unsplash photos, hero `<img onError>` fallback to gallery image, no generated/fake city images |
| Hotel decision support | shipped — filters, detail view, room photos, room/rate options, amenities, taxes/fees, cancellation detail, Google ratings when configured |
| Date editing | shipped — visible per-leg date editor with "Set 3 nights"; changing dates clears stale flight/hotel/itinerary selections |
| Security | frozen — payment-first booking, Stripe amount/currency/offer pinning, prompt injection sanitizer, session-owned canvas writes, admin-secret headers, CSP/security headers |
| Documentation | updated — `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, `docs/PAYMENTS.md`, `docs/TRAVEL-DOCUMENTS.md`, `docs/END-TO-END-TESTING.md`, `docs/AI-QUERY-TESTS.md` |
| Verification before freeze | passed — `npx tsc --noEmit --pretty false`, `npm run build` |

### Payment router correction (2026-05-03)

| Item | Status |
|---|---|
| Canadian merchant-of-record checkout model clarified | shipped — Stripe Balance path collects verified flight fare + transparent FlexeTravels fee before Duffel Balance booking |
| `lib/payments/strategy.ts` pure payment strategy router | shipped |
| `/api/checkout/quote` non-mutating quote endpoint | shipped |
| `/api/stripe/prepare` accepts `paymentStrategy`, multi-flight `flightItems`, verifies Duffel offer prices server-side, and pins all offer IDs | shipped |
| `/api/book-trip` verifies Stripe expected amount and expected currency before supplier booking | shipped |
| Payment architecture documented | shipped — see `docs/PAYMENTS.md` |
| Payment ledger schema drafted | shipped — see `lib/db/schema-payments.sql` |
| Supabase AI analytics schema | shipped — see `lib/db/schema-analytics.sql`; captures AI turns, canvas activity, richer search context, and normalized preference signals |
| Complex AI query regression matrix documented | shipped — see `docs/AI-QUERY-TESTS.md` |
| Runtime payment quote/idempotency hooks | shipped — `/api/stripe/prepare` creates quote rows when migration exists; `/api/book-trip` consumes quote once and writes payment/supplier/ledger rows |
| End-to-end manual testing runbook | shipped — see `docs/END-TO-END-TESTING.md` |

### Phase 0–3: foundation (pre-v2)

- Anonymous-session canvas persistence (`trips_canvas` table + service-role RLS)
- Mapbox route map, lazy-loaded
- AI command bar + chat panel (Claude Sonnet 4.6, 25 tool steps, multi-leg planning)
- Currency picker + dual-currency display
- Strategy-aware Stripe payment flow: supplier-direct fee-only or Canada balance-mode fare + transparent fee
- Cart hand-off to `/booking` from both `/chat` and `/trip` (same `ft_cart` shape)
- Vibe / interests one-time picker → injected into AI system prompt
- Multi-airline + multi-city flight search (Duffel slices)
- Hotel detail panel: stars, score, address, check-in/out, cancellation
- LiteAPI multi-room occupancy fix (lead guest per room)

### Phase 4 — UI polish + canvas richness

| Item | Status |
|---|---|
| Hero photo per leg (live, not hardcoded) | shipped — Wikipedia REST + Unsplash search |
| 6-photo gallery strip per leg | shipped, lazy-loaded via IntersectionObserver |
| Photo source resilience (disambig, missing, broken URL) | shipped — OpenSearch fallback + onError → gradient initials |
| OTA savings disclaimer popover | shipped on the checkout strip |
| Trip share via URL (`?view=shared`) | shipped — sanitized read-only payload, no edit UI |
| Lazy-load Mapbox | shipped — `/trip/[id]` first-load JS dropped 638→170 kB |
| Hero CTA + Nav route to `/trip` when flag on | shipped |
| Drag-and-reorder of legs | shipped via `@dnd-kit/sortable` (touch + keyboard + mouse) |
| Map dynamic update (no stale markers on reorder/remove) | shipped — `useRef<Marker[]>` instead of closure-local property |

### Phase 4.1 — trust + correctness

| Item | Status |
|---|---|
| BC vs Ontario jurisdiction in `/terms` | fixed — now matches BC travel-agent licence |
| Anthropic + Supabase added to `/privacy` subprocessor list | shipped |
| Pseudonym testimonials removed from homepage | replaced with honest "How it works" trio |
| Children + per-child ages threaded through search pipeline | shipped — fixes "toddler not in pricing" |
| `TravellersChip` UI in trip header (adults / children / each child age) | shipped |
| Stale-price banner when traveller mix changes after picking | shipped — amber "re-search" hint |
| Trip total line on `/booking` review | shipped — sums flight + hotel + $20 in one currency |
| Sandbox / test-data banner | shipped — auto-detects via `duffel_test_*` / `sand_*` prefix |
| Hotel detail richness: board pill, free-cancel pill, max occupancy, expandable description, mini-map (Mapbox static), full cancellation timeline, taxes/fees breakdown, contact | shipped |
| Hotel filters: name search, star rating, board type, free-cancel, max price | shipped, all client-side, with "X of Y hotels" counter |

### Phase 5 — production-readiness

| Item | Status |
|---|---|
| Replace hardcoded city → IATA map with **Duffel `/places/suggestions`** API | shipped — Halifax → YHZ, Cleveland → CLE, any city Duffel knows |
| Wikipedia disambiguation fallback via OpenSearch | shipped — handles "Halifax", "Cambridge", "Springfield" etc. |
| Hotel image `<img onError>` fallback | shipped — broken URLs cleanly fall to gradient initials |
| **Production security audit** | 14 / 14 PASS (see audit table below) |
| End-to-end UI smoke test (`e2e/flow.spec.ts`) | shipped — single 24 s test that walks add → reorder → remove → filter → detail → pick, with 10 screenshots per run |
| Image dynamic-update test | shipped — verifies leg.city change refreshes hero |
| Halifax airport regression test | shipped |
| Montreal → YUL (not MON) regression test | shipped |
| Trip total line regression test | shipped |
| Live photos contract test | shipped |

### Phase C — Real Google ratings on hotels (2026-05-02)

| Item | Status |
|---|---|
| `lib/canvas/google-hotel-ratings.ts` — Places Text Search batch enricher with bounded concurrency (5 parallel), 24 h LRU cache, soft-fails when key unset | shipped |
| `NormalizedHotel.googleRating` + `.googleRatingCount` fields | shipped |
| Aggregator post-processes top 10 hotels with a 1.5 s wall-clock budget so slow Places API never balloons search response | shipped |
| `SlotPicker` hotel cards + detail view show real Google rating + review count when present, fall back to synthetic baseline otherwise | shipped |

### Phase E.1 — CI + crash visibility (2026-05-02)

| Item | Status |
|---|---|
| `.github/workflows/ci.yml` — type-check + production build on every PR + push to main, full Playwright suite gated on repo secrets | shipped |
| `/api/client-error` endpoint — rate-limited (10/min/IP), 8 KB body cap, sanitizer-cleaned, writes via existing `logEvent` so crashes show up in `/api/admin/logs` | shipped |
| `components/ErrorBoundary.tsx` — top-level React error boundary, ships sanitized crash reports + componentStack via `keepalive: true`, recoverable plain-CSS fallback UI | shipped |
| Wired into `app/layout.tsx` so every page is covered | shipped |
| Sentry / PostHog SDK | deferred — gated on user provisioning a DSN |

### Phase A — "Things to do" per leg (2026-05-02)

| Item | Status |
|---|---|
| `lib/canvas/itinerary.ts` — Gemini 2.5 Pro with `google_search` grounding + Google Places enrichment, 24 h LRU cache | shipped |
| `/api/canvas/itinerary?city=&days=&interests=` endpoint with 24 h CDN cache | shipped |
| `CanvasItinerary` types + `set_itinerary` / `clear_itinerary` ops | shipped |
| `components/canvas/LegMap.tsx` — Mapbox per-leg map, numbered POI pins, click-to-fly | shipped |
| `components/canvas/ItineraryPanel.tsx` — collapsible day-by-day cards with thumbnails, ratings, hours, maps deeplinks | shipped |
| Wired into `DayLegBlock` between photo strip and slot section | shipped |
| Soft-fails (returns null) when `GEMINI_API_KEY` unset → panel hides cleanly | shipped |
| Input-validation regression tests on `/api/canvas/itinerary` | shipped |

Cost ballpark: Gemini ~$1/day + Places ~$1.20/day at 100 trips/day = ~$70/month total at scale.

### Phase B.1 — Multi-leg success screen (2026-05-02)

| Item | Status |
|---|---|
| `LegBooking` interface + `legBookings` state on `CheckoutCard` | shipped |
| Multi-leg branch on `phase === 'success'` (>1 leg) renders per-leg cards with status pills (booked / partial / failed) | shipped |
| Tally header: "All legs booked!" or "X of Y legs fully booked" | shipped |
| Amber recovery banner pointing to `support@flexetravels.com` when partial/failed | shipped |
| `/api/book-trip` already returns `legs: legResults[]` with `flightOfferId / flightRef / flightError / hotelRateId / hotelName / hotelRef / hotelError` per leg | confirmed in route handler |
| Single-leg success view preserved as fallback for legacy `/chat` flow | shipped |

### Security audit (2026-05-02 snapshot)

All 14 checks **PASS**:

1. No `NEXT_PUBLIC_*` exposing a server secret
2. Sandbox banner correctly disappears in prod (key-prefix detection)
3. Stripe webhook HMAC-verified + 5-min timestamp window + timing-safe compare
4. Payment-first booking guard rejects bad PIs (status, amount, offer match)
5. Canvas mutations require sessionId match; share view sanitized + read-only
6. Rate limit: 100/min global + 3/min `/api/book-trip` + 5/min `/api/stripe/prepare`
7. Admin endpoints require `x-admin-secret` HEADER (timing-safe)
8. CSP: no wildcards in connect-src; X-Frame DENY; HSTS; strict referrer
9. Logging hygiene: no token / credential printed
10. Input validation: `/api/canvas/resolve-airport` length-bounds, no arbitrary proxy
11. Shared-view GET strips `session_id` / `user_id`, rejects PATCH
12. Stripe PI amount/currency verified from server-side quote metadata; client price claims never override supplier offer verification
13. No CORS wildcards
14. `/api/canvas/photos` cached publicly (s-maxage=86400, stale-while-revalidate=86400)

---

## E2E test suite (24 tests, all green)

```
Homepage:
  ✓ Hero CTA points to /trip when flag on
  ✓ Honest-pricing trio replaces pseudonym testimonials

Legal pages:
  ✓ /terms references British Columbia
  ✓ /privacy lists Anthropic + Supabase as subprocessors

Chat-route flag:
  ✓ /chat redirects to /trip when canvas flag on

Trip canvas:
  ✓ creates a new canvas + shows the vibe picker
  ✓ shows the share button + leg-add affordance
  ✓ add-leg dialog adds a leg and renders it
  ✓ desktop drag reorders two legs end-to-end
  ✓ mobile reorder arrows swap two legs

OTA disclaimer popover:
  ✓ heuristic explainer opens on click

Airport resolver:
  ✓ Montreal resolves to YUL (not MON)
  ✓ Halifax resolves via Duffel /places/suggestions (not in local map)
  ✓ Montreal leg → flight search uses YUL canonical

Destination coverage:
  ✓ Puerto Vallarta + PVR resolve to the same hero
  ✓ Puerto Vallarta leg renders hero + gallery
  ✓ Leg block uses live photos from /api/canvas/photos

Checkout review:
  ✓ Trip total line sums flight + hotel + fee

Shared / read-only view:
  ✓ GET /api/trip/[id] requires sessionId in owner mode
  ✓ ?view=shared bypasses sessionId
  ✓ shared canvas page renders read-only banner + no editing UI

Real user flow (NEW):
  ✓ add → reorder → remove → hotel filters → hotel detail (with screenshots)

Destination images update dynamically (NEW):
  ✓ changing the leg city refreshes the hero photo

Visual captures:
  ✓ Montreal canvas relevance check
  ✓ Puerto Vallarta canvas + booking screenshots
```

---

## Operational posture

- **Build:** `/trip/[id]` first-load JS at **~169 kB** (down from 638 kB before lazy-loading Mapbox).
- **Photo endpoints:** 24 h CDN cache + 24 h SWR, in-memory LRU (500 entries) for repeat queries inside the same dyno.
- **Airport resolver:** 1 h cache on hits, 5 min on misses, 6 s timeout against Duffel.
- **Hotel detail:** 60 min in-memory cache (`HOTEL_DETAIL_CACHE` in `liteapi.ts`).
- **Flight + hotel search:** 60–120 s in-memory cache, applies filters post-cache so a single Duffel roundtrip serves every filter combo within the TTL.

---

## Known watchpoints (not blockers, but to monitor in prod)

1. **Wikipedia OpenSearch latency.** When a city's article is a disambig, we make 2 sequential calls (summary + opensearch + retry-summary). Worst case ~5 s before the hero appears. Cached for 24 h after first hit.
2. **LiteAPI hotel image URLs.** Some prod hotels have broken/dead photo URLs in `main_photo`. The new `<img onError>` fallback handles it cleanly; there's no broken-image icon — falls to gradient initials with the hotel's first 1–2 letters.
3. **Filters narrow to 0 with sparse field data.** If LiteAPI prod doesn't always return `boardType` / `boardName` / `refundableTag` for every hotel, clicking the corresponding chip can empty the list. Empty state has a clear `[ clear filters ]` link, so the UX is recoverable.
4. **Duffel sandbox flight data is mock.** Sandbox banner makes this clear; once `DUFFEL_ACCESS_TOKEN` is `duffel_live_*` the banner disappears automatically.
5. **Browser cache vs `?view=shared`.** A user who shares a link before saving the latest edits may see stale data on the shared page. The 24 h CDN cache on photos is intentional; trip state itself is server-side and always fresh.

See `ROADMAP.md` for the next phase of work.
