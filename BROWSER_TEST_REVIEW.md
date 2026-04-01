# FlexeTravels — Browser Test Review & Improvement Plan
**Date:** April 1, 2026
**Scope:** Full end-to-end walkthrough: Landing → Chat → Search → Hotel Modal → Checkout → Sign In
**Environment:** Production keys (Duffel live, LiteAPI live, Stripe live)

---

## 1. Sign In / Google OAuth

### Observation
The Google OAuth screen shows `pdohnltcgsgdwvxvtgoa.supabase.co` as the "continue to" destination.

### Verdict: ✅ Working correctly — this is expected
When Supabase Auth handles Google OAuth, it registers its own callback URL (`https://[project].supabase.co/auth/v1/callback`) as the redirect URI in Google Cloud Console. Google always shows the registered redirect domain, not your app domain. After authentication, Supabase exchanges the code and redirects back to your app. This is standard OAuth PKCE flow — no issue here.

### What to monitor
- If users ask "why does it say supabase?" — consider adding a brief explainer on the login page: "Sign in is powered by Google via Supabase Auth."
- The redirect back to `/chat` after login should work seamlessly.

---

## 2. Chat Interface & Search

### What's working ✅
- AI concierge chat loads and accepts messages
- `searchFlights` and `searchHotels` tool calls fire correctly
- Streaming response delivers content progressively
- `[FLIGHT_CARD]` and `[HOTEL_CARD]` tags parse into visual React cards
- Flight cards show boarding-pass styling with airline, route, price, stops
- Hotel cards show image, stars, price, cancellation badge
- "Best value" / "Best deal" badges surface correctly on top results
- "Scroll up" prompt after hotel selection works

### Issues Found

#### 2a. Latency is high — 30–40s total response time
- Duffel real-time pricing: 8–15s
- Claude generation + streaming: adds another 15–25s
- Users see a blank/loading state for the first 5–10 seconds
- **Risk:** High abandonment before first content appears

#### 2b. No loading progress indicator during tool calls
- The chat shows "..." or a generic spinner while tools are running
- No breakdown of which tool is executing (flights? hotels?)
- Users don't know if something is happening or broken

#### 2c. `maxSteps: 2` limits conversational recovery
- If a tool call fails, Claude can't retry or clarify
- User gets a hard error instead of a graceful retry

---

## 3. Hotel "View Details" Modal

### What's working ✅
- Modal opens on click
- Hero photo gallery displays
- Stars, rating score, check-in/check-out times render
- Amenities grid shows with icons
- Cancellation policy section renders
- Map embed (OpenStreetMap) shows location

### Bugs Found

#### 3a. 🐛 HTML entities not decoded in description (CONFIRMED)
**Location:** `components/HotelDetailModal.tsx` line 265

The description HTML is stripped of tags but HTML entities are NOT decoded:
```typescript
const descPlain = descHtml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
```

This results in `&amp;` showing as literal text (`&amp;`) instead of `&`, `&nbsp;` as literal whitespace codes, `&rsquo;` as `&rsquo;` instead of `'`, etc.

**Visible to user:** "Garden &amp; Pool" instead of "Garden & Pool" in the About this property section.

**Fix needed:** Add HTML entity decoding after stripping tags, using a textarea decode trick or a minimal decode function.

#### 3b. 🐛 Room options section not rendering
**Location:** `components/HotelDetailModal.tsx` — Section F (Room comparison)

`roomTypes = hotel.allRoomTypes ?? []` — this data field is populated by the AI in the HOTEL_CARD tag, but:
- The AI currently emits only summary hotel fields into the card tag
- `allRoomTypes` is often `undefined` or an empty array coming from the card
- The section header exists in the code but renders nothing if `roomTypes.length === 0`
- Users scroll past the description and cancellation policy and see no rooms to compare

**Fix needed:** Either populate `allRoomTypes` from the hotel search results in the AI tool response, or fetch room details when the modal opens using the hotel ID and date params.

#### 3c. Minor: Modal scroll stops visually after cancellation policy
- On mobile, the bottom padding is insufficient — the last section clips behind the bottom of the viewport
- The `overflow-y-auto` container needs `pb-16` to account for safe-area insets

---

## 4. Checkout Flow

### What's working ✅
- Step 1 (Review): Trip summary, passenger count controls, cost breakdown all display
- Step 2 (Passengers): Form fields validate, error messages surface
- Step 3 (Payment): Stripe Elements mounts and renders the card form
- Stripe sandbox card `4242...` accepted
- Success screen shows confirmation refs

### Critical Issues Found

#### 4a. 🚨 CRITICAL: Real bookings fire BEFORE payment is charged
**Current flow:**
1. Passenger form → "Book Trip" → calls `/api/book-trip`
2. `/api/book-trip` → calls Duffel (creates real flight order) + LiteAPI (prebooks hotel)
3. Returns `clientSecret` → shows Stripe form
4. User pays $20 (or doesn't)

**Problem:** On production keys, a real Duffel order and LiteAPI prebook are created the moment the user clicks "Book Trip" — **before** they pay anything. If the user closes the tab, declines the card, or the Stripe form fails, you have:
- A real flight booking with Duffel (consuming inventory, possibly non-refundable)
- A real hotel prebook with LiteAPI (TTL ~5 min, but still real)
- Zero revenue collected

**Fix required:** Reverse the order entirely:
1. Passenger form validates → calls `/api/stripe/prepare` (creates $20 PaymentIntent only)
2. Stripe form shown → user pays $20
3. Payment confirmed → THEN calls `/api/book-trip` with `paymentIntentId` as proof
4. Server verifies PaymentIntent `status === 'succeeded'` before touching any booking APIs
5. Success screen shows confirmed refs

**Status:** Implementation in progress.

#### 4b. Payment phase shows "Flight booked" / "Hotel booked" banners prematurely
These confirmations appear at the top of Step 3 (the payment screen), but in the current flow the bookings have just been made — the user hasn't paid yet. This creates confusion and false assurance. The UI needs to reflect the new payment-first flow.

#### 4c. Booking spinner says "Securing your reservation…" during PaymentIntent creation
After the flow change, the booking spinner will show AFTER payment — messaging is still appropriate, but the brief moment when the PaymentIntent is being created (< 1s) should use a lighter indicator (disabled button with spinner) rather than the full-screen spinner.

#### 4d. No "Back" option from payment step
Once Stripe Elements is mounted, there's no way to go back to Passengers to correct details. A back button from payment to passengers would reduce frustration.

#### 4e. Price-change detection timing
Currently, stale Duffel pricing is detected during `/api/book-trip`. After the payment-first change, this detection happens after payment — meaning a user could pay $20 then see a price change. Need to either pre-validate the price before showing the payment form, or handle the edge case gracefully post-payment.

---

## 5. Security Issues Found & Fixed

| Issue | Status |
|-------|--------|
| Health endpoint `/api/health` was leaking Supabase project URL in response body | ✅ Fixed — URL removed from response |
| Stripe webhook missing secret returned HTTP 500 (reveals configuration state) | ✅ Fixed — returns 503 now |
| Email validation used `includes('@')` — too permissive | ✅ Fixed — proper regex |
| Phone validation allowed strings under 7 digits | ✅ Fixed — bounds check added |
| Silent `.catch()` blocks were swallowing DB errors without any log | ✅ Fixed — now log warnings |

---

## 6. TypeScript / Build Issues Found & Fixed

5 TypeScript errors in `--strict` mode — all fixed by adding proper Supabase session type annotations in:
- `app/chat/page.tsx`
- `app/profile/page.tsx`
- `components/Nav.tsx` (2 errors)

**Also fixed:** `next.config.js` — `outputFileTracingRoot` was pointing 3 levels above the project root (`__dirname + '/../../..'`) which would cause Railway's standalone Docker build to trace files outside the project. Fixed to `__dirname`.

---

## 7. Performance Observations

| Step | Time observed | Notes |
|------|--------------|-------|
| Chat → first streamed token | ~5–10s | Duffel search dominates |
| Full AI response | ~30–40s | Flights 8–15s + Claude generation |
| `/api/book-trip` (flight + hotel) | ~10–20s | Sequential: Duffel order → LiteAPI prebook → LiteAPI book |
| Stripe PaymentIntent creation | <1s | Stripe API is fast |

**Main bottleneck:** Duffel's real-time pricing API. Searching multiple routes takes the full 15s timeout. There's no way to speed this up without caching (which risks stale prices) or showing partial results.

---

## 8. UX Issues Summary

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 1 | Chat | No visible progress indicator while tools run | Medium |
| 2 | Chat | 30–40s total wait before response — no interim feedback | High |
| 3 | Hotel modal | `&amp;` and other HTML entities not decoded | Medium |
| 4 | Hotel modal | Room comparison section empty | Medium |
| 5 | Hotel modal | Mobile bottom padding clips last section | Low |
| 6 | Checkout | Real bookings before payment | Critical |
| 7 | Checkout | No back button from payment step | Low |
| 8 | Checkout | False "booked" confirmations shown before payment | Medium |
| 9 | Checkout | Price-change detection after payment (post-fix) | Medium |
| 10 | Sign In | Supabase URL visible in OAuth — confusing to non-technical users | Low |

---

## 9. Improvement Plan (Prioritised)

### P0 — Critical (do now, live keys at risk)

**[P0-1] Payment-first checkout** — `CheckoutCard.tsx` + new `/api/stripe/prepare` route + `/api/book-trip` payment verification
- Create `/api/stripe/prepare` — creates $20 PaymentIntent, returns `clientSecret`
- `handleBook()` calls `/api/stripe/prepare` → shows Stripe form
- `handlePay()` on success → calls `/api/book-trip` with `paymentIntentId`
- `/api/book-trip` verifies `payment_intents/:id` status = `succeeded` before any booking API calls
- Update payment phase UI — remove premature "booked" banners, add "pay now → we book instantly" messaging

### P1 — High Impact

**[P1-1] Fix HTML entity decoding in HotelDetailModal**
```typescript
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
const descPlain = decodeHtmlEntities(descHtml.replace(/<[^>]+>/g, ' '))
  .replace(/\s{2,}/g, ' ').trim();
```

**[P1-2] Fix room options in hotel modal**
- Pass `allRoomTypes` from LiteAPI hotel search through to the hotel card JSON
- Or: fetch room details via LiteAPI `/hotels/:id/room-types` when modal opens (lazy load)
- Add a loading skeleton while fetching, graceful empty state if unavailable

**[P1-3] Add chat loading progress indicator**
- Show named steps while tools are executing: "Searching flights…" → "Searching hotels…" → "Building your recommendations…"
- Use a step-progress bar or animated tool-call pills
- This dramatically reduces perceived wait time

### P2 — Medium Impact

**[P2-1] Add back button from payment step to passengers**
- Allow editing passenger details before paying
- Unmount Stripe Elements on back navigation (call `mountRef.current?.destroy()`)

**[P2-2] Price pre-validation before payment form**
- After passenger validation, call a lightweight `/api/check-price` that re-fetches Duffel offer price
- If price changed: surface banner before showing payment form
- This prevents the post-payment price-change surprise

**[P2-3] Mobile modal scroll fix**
- Add `pb-safe` or `pb-16` to the `HotelDetailModal` scrollable container
- Test on real iOS/Android viewport

**[P2-4] TTL-based `confirmed-payments.ts`**
- Current: plain `Map` — entries live forever, leaks memory over time
- Fix: TTL-based map (purge entries older than 24h) — prevents unbounded memory growth in long-running Railway deployment

### P3 — Polish

**[P3-1] Sign In page explainer**
- Add a small note: "Authentication powered by Google via Supabase" to reassure users seeing the Supabase URL

**[P3-2] Booking spinner copy after payment**
- After payment, spinner should say "Booking your trip…" not "Securing your reservation…" (same phrase used during PI creation)

**[P3-3] Error recovery for booking failure post-payment**
- If payment succeeds but booking fails (Duffel/LiteAPI error), the error message should:
  - Clearly say "Your $20 was charged"
  - Give a support contact email / reference number
  - Offer to retry booking (since payment is already confirmed)

**[P3-4] Destination image quality**
- Some destination images fall back to no-image state
- Consider adding a placeholder gradient with destination name

---

## 10. Deployment Notes

- All code changes deploy via `git push origin main` → Railway auto-deploy (~2–3 min)
- TypeScript errors will NOT block Railway build (`typescript: { ignoreBuildErrors: true }` in `next.config.js`) — but should still be caught in pre-deploy check
- DB schema changes require manual paste into Supabase SQL Editor (no migration runner)
- Stripe webhook must be registered at `https://www.flexetravels.com/api/webhooks/stripe` in Stripe Dashboard

---

## 11. What's Been Shipped (this session)

### Security & Stability
| Fix | File |
|-----|------|
| TypeScript strict-mode errors (5 errors) | `app/chat/page.tsx`, `app/profile/page.tsx`, `components/Nav.tsx` |
| Health endpoint leaking Supabase URL | `app/api/health/route.ts` |
| Webhook 500 → 503 on missing secret | `app/api/webhooks/stripe/route.ts` |
| Email validation regex | `components/CheckoutCard.tsx` |
| Price precision (Math.round) | `components/CheckoutCard.tsx` |
| LiteAPI SDK load timeout (was infinite) | `components/CheckoutCard.tsx` |
| `outputFileTracingRoot` Railway fix | `next.config.js` |
| UTC month for season in system prompt | `app/api/chat/route.ts` |
| Silent DB error catches now log warnings | `app/api/chat/route.ts` |

### Payment-First Checkout (Critical)
| Change | File(s) |
|--------|---------|
| New 4-step checkout: Review → Passengers → Invoice → Pay | `components/CheckoutCard.tsx` |
| Invoice step: full trip/passenger/cost summary before payment | `components/CheckoutCard.tsx` |
| PaymentIntent created before any booking (payment-first) | `app/api/stripe/prepare/route.ts` (new) |
| Server verifies PaymentIntent `succeeded` before Duffel/LiteAPI | `app/api/book-trip/route.ts` |
| "Review & Pay" button label on passengers step | `components/CheckoutCard.tsx` |
| Service fee always displayed as USD $20 | `components/CheckoutCard.tsx` |
| `getPaymentIntent()` helper added | `lib/stripe.ts` |
| CLAUDE.md checkout flow documentation updated | `CLAUDE.md` |

### Hotel Modal UX
| Fix | File |
|-----|------|
| HTML entity decoding (`&amp;` → `&`, etc.) in description | `components/HotelDetailModal.tsx` |
| Mobile bottom padding (last section no longer clips) | `components/HotelDetailModal.tsx` |

## 12. Still To Do

| Priority | Item |
|----------|------|
| P1 | Populate `allRoomTypes` from search results so room comparison section shows |
| P1 | Chat loading progress indicator (named steps while tools run) |
| P2 | Price pre-validation before showing payment form |
| P2 | TTL-based `confirmed-payments.ts` (prevent memory leak in long-running Railway process) |
| P3 | Sign In page note explaining Supabase OAuth URL |
| P3 | Retry booking on post-payment failure (PI already confirmed) |
