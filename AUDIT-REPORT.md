# FlexeTravels Audit Report: Duffel API Compliance, Regulatory Gaps & Checkout Bug

**Date:** April 13, 2026  
**Scope:** Duffel API v2 reference vs. codebase implementation, US/Canada travel regulations, checkout flow debugging

---

## CRITICAL BUG: Checkout Page Broken After Flight Selection

**Root cause:** `handleSelectFlight()` in `app/chat/page.tsx` (line 446) updates React state (`setCartFlight`) but does NOT write to `sessionStorage`. The `/booking` page reads from `sessionStorage` and finds nothing.

**The break in the chain:**

| Action | sessionStorage written? | React state |
|--------|------------------------|-------------|
| Click "Select" on flight card | NO | Updated |
| Click "Select" on hotel card | YES (includes flight from state) | Updated |
| Click "Proceed to Booking" | YES (re-stamps) | Both set |
| Navigate to `/booking` after flight-only | EMPTY - shows "Nothing in your cart" | Lost |

**Why it fails:** If a user selects a flight and then navigates to `/booking` (or the page refreshes before hotel selection), `sessionStorage` has no `ft_cart` key. The booking page (line 219) checks `if (!cart?.flight && !cart?.hotel)` and renders the "Nothing in your cart" empty state.

**Fix needed:** Add `sessionStorage.setItem('ft_cart', ...)` inside `handleSelectFlight` just like `handleSelectHotel` does at line 464.

---

## SECTION A: Duffel API Gaps (Things Done Incorrectly)

### A1. Title & Gender Hardcoded for ALL Passengers (CRITICAL)

**File:** `lib/agents/booking.ts` lines 217-264, 343-355

Every passenger is sent to Duffel with `title: 'mr'` and `gender: 'm'` regardless of actual gender. This applies to adults, children, and infants alike. Female passengers, children, and infants all get submitted as "Mr" with gender "m".

**Duffel requirement:** `title` must be one of: Mr, Ms, Mrs, Mx, Dr. `gender` must be "m" or "f". These must match the passenger's travel document.

**Impact:** Airlines can reject the booking or issue tickets with incorrect passenger data. For international flights to the US/Canada, this violates TSA Secure Flight requirements which mandate accurate gender.

**Category:** BUG - must fix. The checkout form needs gender and title fields.

---

### A2. No Passenger Title/Gender Collection in Checkout Form

**File:** `components/CheckoutCard.tsx` lines 59-71

The `Passenger` interface collects: firstName, lastName, dateOfBirth, email, phone.  
The `ChildPassenger` interface collects: firstName, lastName, dateOfBirth.

**Missing fields that Duffel requires:**
- `title` (Mr/Ms/Mrs/Mx/Dr)
- `gender` (m/f)

**Category:** BUG - direct consequence of A1. Must add form fields.

---

### A3. No Offer Expiration Check Before Booking

**Duffel API:** Every offer has an `expires_at` timestamp (typically 30 minutes). Booking an expired offer returns 422.

**Codebase:** The `DuffelOffer` interface in `duffel.ts` (line 31) does not even include `expires_at`. The `mapOffer()` function never passes it through. There is no client-side or server-side check of offer expiry before attempting to book.

**Current mitigation:** The booking agent handles 422 errors by refreshing the offer (line 298-369), but this is reactive rather than preventive, and the refresh may return a different price.

**Category:** DESIGN GAP - the 422 retry works as a safety net, but showing the user "offer expired" and requiring re-search would be better UX. At minimum, pass `expires_at` to the frontend so the checkout page can warn before attempting payment.

---

### A4. No Idempotency Key on Order Creation

**Duffel best practice:** Use `Idempotency-Key` header (UUID) on POST requests to prevent duplicate bookings on network retries.

**Codebase:** `lib/agents/booking.ts` line 274-289 creates orders without any idempotency header. If the request times out and the client retries, a duplicate booking could be created.

**Category:** ARCHITECTURE GAP - critical for production. Network timeouts on the 30s order creation call could lead to double-bookings.

---

### A5. No Retry Logic with Exponential Backoff for 5xx Errors

**Duffel docs:** 5xx errors (500, 502, 503, 504) are safe to retry. Duffel confirms no booking is created in supplier systems on 5xx. Recommended: exponential backoff with jitter, 3-5 attempts.

**Codebase:** The booking agent has a single retry on 422 (expired offer) but NO retry for 5xx errors. If Duffel returns a 502 (airline system error), the booking simply fails.

**Category:** ARCHITECTURE GAP - should implement retry with backoff for 5xx responses.

---

### A6. Missing Baggage Information Display

**Duffel API:** Each offer contains `slices[].segments[].passengers[].baggages[]` with quantity and weight details for included baggage.

**Codebase:** The `DuffelSegment` interface (line 18-26) does not include baggage data. `mapOffer()` never extracts it. No baggage information is shown to users in flight cards or checkout.

**US DOT regulation (14 CFR 399.85):** Airlines operating to/from the US must disclose baggage fees and allowances. For a booking platform, this means showing what's included in the fare.

**Category:** REGULATORY GAP (US) + DESIGN GAP - must display included baggage to comply with US DOT full-fare advertising rules.

---

### A7. No Seat Map Support

**Duffel API:** Provides seat map endpoints for visual seat selection with pricing.

**Codebase:** No seat map integration exists anywhere. While seat selection is optional, it's a significant feature gap.

**Category:** DESIGN CONSTRAINT - intentionally excluded (not a bug). Could be a future feature.

---

### A8. No Order Change/Cancellation Support

**Duffel API:** Full order change and cancellation flows with refund handling.

**Codebase:** No endpoints for modifying or cancelling bookings post-creation. Users have no self-service way to change flights.

**Category:** DESIGN CONSTRAINT - acknowledged scope limitation. However, for US/Canada compliance, customers should be informed about change/cancellation rights at booking time.

---

### A9. Duffel Webhook HMAC Signature Not Verified

**Duffel docs:** Webhooks include HMAC signature in headers for authentication. Must verify to prevent spoofed events.

**Codebase:** The events table stores raw payloads, but I found no evidence of HMAC signature verification on incoming Duffel webhooks. `DUFFEL_WEBHOOK_SECRET` is in the env vars list but verification logic was not found in the webhook handler.

**Category:** ARCHITECTURE GAP - security risk in production.

---

### A10. HTTP Client Timeout Too Short

**Duffel docs:** Recommend setting HTTP client timeout to >= 130 seconds (Duffel max processing time is 120s + buffer).

**Codebase:**
- Search: 15s timeout (`duffel.ts` line 166) - OK for search since `supplier_timeout` isn't set
- Order creation: 30s timeout (`booking.ts` line 289) - TOO SHORT. Duffel order creation can take up to 120s for some airlines

**Category:** ARCHITECTURE GAP - order creation timeout should be at least 60-90s to account for slow airline systems.

---

### A11. `supplier_timeout` Not Set on Offer Requests

**Duffel API:** `supplier_timeout` parameter (2-60s) controls how long to wait for airline responses. Default is 20s.

**Codebase:** The offer request in `duffel.ts` line 156-166 does not set `supplier_timeout`. Combined with the 15s `AbortSignal.timeout`, there's a race: Duffel may still be waiting for airlines when the client aborts.

**Category:** DESIGN GAP - should set `supplier_timeout: 14` to ensure Duffel responds before the 15s client timeout.

---

### A12. Pagination Not Implemented for Offers

**Duffel API:** `return_offers=true` returns paginated results. Default limit is 50, supports cursor-based pagination with `?after=` parameter.

**Codebase:** Takes only the first page of results (line 174), sorts and slices to top 10. For popular routes, there could be 100+ offers; the app only sees the first 50.

**Category:** DESIGN CONSTRAINT - acceptable for the "show top 3" UX, but may miss better-priced offers on subsequent pages.

---

### A13. No `return_available_services` for Baggage Upsell

**Duffel API:** Setting `return_available_services=true` on offer requests returns purchasable extras (extra bags, seats).

**Codebase:** Not requested. No baggage or seat upsell is offered.

**Category:** DESIGN CONSTRAINT - intentionally not implemented.

---

## SECTION B: US/Canada Regulatory Compliance Gaps

### B1. No TSA Secure Flight Data Collection (US CRITICAL)

**Regulation:** TSA Secure Flight (49 CFR 1560) requires: full legal name (as on government ID), date of birth, gender, and Redress Number/Known Traveler Number for all passengers on flights over the continental US.

**Codebase gaps:**
- Gender is NOT collected (hardcoded 'm' per A1/A2)
- No middle name field (Duffel doesn't require it, but TSA matching works better with full name)
- No Redress Number field
- No Known Traveler Number (KTN/TSA PreCheck) field

**Impact:** Passengers may experience extra screening or be denied boarding if their name/gender doesn't match TSA records.

**Category:** REGULATORY GAP - must add gender collection at minimum.

---

### B2. No APIS (Advance Passenger Information) for International Flights

**Regulation:** US CBP requires APIS data for all international flights to/from the US: passport number, issuing country, expiration date, nationality, and US destination address.

**Canada:** CBSA requires similar data under the Advance Passenger Information/Passenger Name Record program.

**Codebase:** No passport/travel document fields are collected anywhere. The passenger form only asks for name, DOB, email, phone.

**Note:** Duffel may handle APIS collection post-booking for some airlines, but the booking may fail at order creation if the airline requires APIS data upfront.

**Category:** REGULATORY GAP - for international routes (which this platform explicitly supports), passport data collection is needed.

---

### B3. No Full Fare Advertising Compliance (US DOT)

**Regulation:** US DOT 14 CFR 399.84 requires that advertised fares must be the full price including all mandatory taxes and fees. The fare cannot be shown unbundled.

**Codebase:** Flight prices shown are Duffel's `total_amount` which DOES include taxes. However:
- The $20 service fee is shown separately (this is OK - agent fees can be disclosed separately)
- No baggage fee disclosure (violation of 14 CFR 399.85)
- No clear breakdown of base fare vs taxes in the flight card

**Category:** PARTIAL COMPLIANCE - taxes are included in the price, but baggage fee disclosure is missing.

---

### B4. No 24-Hour Free Cancellation Disclosure (US DOT)

**Regulation:** US DOT 14 CFR 259.5(b)(4) requires airlines to allow free cancellation within 24 hours of booking (for tickets purchased 7+ days before departure). Booking platforms must inform passengers of this right.

**Codebase:** The flexibility scoring system shows "Refundable/Changeable/Locked" badges, but there is no specific mention of the 24-hour free cancellation right. This is a mandatory disclosure for US-bound flights.

**Category:** REGULATORY GAP - must add 24-hour cancellation notice during checkout.

---

### B5. No Cancellation/Change Policy Disclosure at Time of Purchase

**Regulation:** US DOT requires clear disclosure of change/cancellation policies before purchase. Canada's Air Passenger Protection Regulations (APPR) also require fare condition disclosure.

**Codebase:** The `FlexibilityBadge` component shows a label (Flexible/Moderate/Locked) and the checkout invoice shows `raw_conditions`. But the specific dollar amounts for change/cancellation penalties are not prominently displayed during checkout.

**Category:** PARTIAL COMPLIANCE - conditions exist in the data but need more prominent display.

---

### B6. No Passenger Rights Information (Canada APPR)

**Regulation:** Canadian Air Passenger Protection Regulations require carriers/agents to inform passengers of their rights regarding: delays/cancellations, tarmac delays, denied boarding, lost baggage.

**Codebase:** No APPR rights information is displayed anywhere in the booking flow.

**Category:** REGULATORY GAP - should add a link or disclosure about passenger rights for Canadian flights.

---

### B7. `guestNationality` Defaults to 'CA' for All Users

**File:** `app/api/book-trip/route.ts` line 46

All bookings default `guestNationality` to 'CA' (Canada). For US customers or international travelers, this could cause issues with hotel bookings (LiteAPI uses nationality for rate eligibility) and is factually incorrect for non-Canadian users.

**Category:** BUG - should ask users for their nationality/citizenship or detect from location.

---

### B8. No Price Comparison or Total Trip Cost Display

**Regulation:** While not strictly mandated, US DOT and Canada's Competition Bureau expect transparent pricing. The checkout flow shows flight and hotel prices separately but does not show a clear total trip cost (flight + hotel + service fee) until the invoice step.

**Category:** DESIGN GAP - would improve compliance posture and user trust.

---

## SECTION C: Architecture/Design Issues (Not Regulatory)

### C1. sessionStorage Cart Not Encrypted

Cart data including flight offer IDs and pricing is stored in plain text in `sessionStorage`. While not a regulatory issue, it means anyone with browser dev tools access can see and modify booking data.

**Category:** DESIGN CONSTRAINT - acceptable for MVP, but consider signing the cart data.

---

### C2. No Rate Limiting on `/api/book-trip`

The chat endpoint has rate limiting (15 calls/minute per session), but the booking endpoint has none. A malicious actor could spam booking attempts.

**Category:** ARCHITECTURE GAP - add rate limiting before going live.

---

### C3. 4-Minute Cart Staleness vs Duffel's ~30-Minute Offer Expiry

The checkout page warns after 4 minutes (`CART_STALE_MS`), but Duffel offers typically expire after 30 minutes. The 4-minute window is unnecessarily aggressive and may frustrate users filling out passenger forms.

**Category:** DESIGN GAP - consider extending to 15-20 minutes, or use the actual `expires_at` from Duffel.

---

### C4. Error Messages Expose Internal Details

Duffel error responses are sometimes passed through to the frontend (e.g., `booking.ts` line 296: first 300 chars of response). These may contain internal API details.

**Category:** ARCHITECTURE GAP - should sanitize all error messages before returning to client.

---

### C5. No Return/Round-Trip Display Differentiation

The codebase supports round-trip via `returnDate` in the search, and the Duffel request includes two slices. However, the `mapOffer()` function only maps `offer.slices[0]` (line 57). The return leg's segments are not extracted or displayed.

**Category:** BUG - round-trip bookings will only show the outbound leg in flight cards.

---

### C6. Infant Fallback Creates Fabricated Passenger Data

**File:** `lib/agents/booking.ts` lines 242-256

When infant form data is missing, the system fabricates a passenger: `given_name: 'Infant'`, `family_name: [lead adult's last name]`, `born_on: [6 months ago]`. This sends fabricated PII to Duffel for a real booking.

**Category:** BUG - should reject the booking if infant data is missing, not fabricate it.

---

### C7. No Operating Carrier vs Marketing Carrier Distinction

**Duffel API:** Returns both `marketing_carrier` and `operating_carrier` for each segment (codeshare flights).

**Codebase:** Only uses `marketing_carrier` (line 24, 93). For codeshare flights, the actual operating airline is not shown to the user.

**US DOT regulation:** Requires disclosure of the operating carrier when different from the marketing carrier.

**Category:** REGULATORY GAP (US) - must display operating carrier for codeshare transparency.

---

## Summary: Priority Matrix

| Priority | Issue | Category | Section |
|----------|-------|----------|---------|
| P0 - Fix Now | Checkout broken after flight selection | BUG | Critical Bug |
| P0 - Fix Now | Title/gender hardcoded as 'mr'/'m' | BUG | A1, A2 |
| P0 - Fix Now | Round-trip return leg not displayed | BUG | C5 |
| P0 - Fix Now | Fabricated infant passenger data | BUG | C6 |
| P1 - Before Launch | No TSA Secure Flight data (gender) | REGULATORY | B1 |
| P1 - Before Launch | No baggage info displayed | REGULATORY | A6, B3 |
| P1 - Before Launch | No 24-hour cancellation disclosure | REGULATORY | B4 |
| P1 - Before Launch | No operating carrier disclosure | REGULATORY | C7 |
| P1 - Before Launch | No idempotency key on orders | ARCHITECTURE | A4 |
| P1 - Before Launch | Order creation timeout too short | ARCHITECTURE | A10 |
| P1 - Before Launch | No rate limiting on book-trip | ARCHITECTURE | C2 |
| P2 - Should Fix | No APIS/passport collection | REGULATORY | B2 |
| P2 - Should Fix | No APPR rights disclosure | REGULATORY | B6 |
| P2 - Should Fix | Nationality defaults to CA | BUG | B7 |
| P2 - Should Fix | No 5xx retry logic | ARCHITECTURE | A5 |
| P2 - Should Fix | No webhook HMAC verification | ARCHITECTURE | A9 |
| P2 - Should Fix | No supplier_timeout set | DESIGN | A11 |
| P2 - Should Fix | Offer expiration not tracked | DESIGN | A3 |
| P3 - Nice to Have | Seat map support | DESIGN | A7 |
| P3 - Nice to Have | Order change/cancellation | DESIGN | A8 |
| P3 - Nice to Have | Pagination for offers | DESIGN | A12 |
| P3 - Nice to Have | Available services/upsell | DESIGN | A13 |
| P3 - Nice to Have | Cart staleness too aggressive | DESIGN | C3 |
| P3 - Nice to Have | Error message sanitization | ARCHITECTURE | C4 |
| P3 - Nice to Have | Cart data signing | DESIGN | C1 |
