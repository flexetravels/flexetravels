# FlexeTravels — Agent Flow, Prompt Critique & Regulatory Deep-Scan

---

## PART 1: Does Duffel Support 24-Hour Free Cancellation?

**Short answer: Yes, Duffel supports it — but FlexeTravels does NOT expose it to users.**

Duffel implements the US DOT 14 CFR 259.5(b)(4) requirement via **voidable orders**:

- Every Duffel order response includes a `voidable_until` field — an ISO 8601 timestamp within 24 hours of booking, provided the flight departs 7+ days from purchase.
- Two-step cancellation API:
  1. `POST /air/order_cancellations` → creates a quote, returns `refund_amount`
  2. `POST /air/order_cancellations/{id}/actions/confirm` → triggers actual cancellation + refund
- Within the void window: full refund, no airline penalty.
- After the void window: airline-specific refund amount (may be zero for non-refundable fares).

**What FlexeTravels is missing:**

| Gap | Impact |
|-----|--------|
| `voidable_until` field never stored or displayed | User doesn't know their cancellation deadline |
| No cancellation endpoint exposed to users | Can't self-serve the 24-hour void |
| No disclosure during checkout | Violates US DOT disclosure requirement |
| No webhook handler for `order.airline_initiated_change_detected` | Airline schedule changes go undetected |
| Refund flow back to customer undefined | If Duffel refunds to balance, customer never gets money back |

**The refund loop problem:** When Duffel cancels an order, the refund goes to your Duffel account balance — NOT automatically back to the customer's card. FlexeTravels has no code to trigger a corresponding Stripe refund to the user.

---

## PART 2: Agent Flow Diagram

### Worked Example
User: **"I want to go to Cancún for a week with my wife. Flying from Toronto. Budget around $4,000."**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER INPUT: "Cancun for a week with my wife, from Toronto, ~$4000 budget"  │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  NEXT.JS CHAT API  ·  POST /api/chat  ·  app/api/chat/route.ts             │
│                                                                             │
│  1. Rate limit check: 15 req/min per sessionId                              │
│  2. Message compression: last 6 messages kept                               │
│  3. buildSystem() → injects today's date, season, IATA codes               │
│  4. Claude (claude-sonnet-4-6, maxTokens=2500, maxSteps=2)                  │
│                                                                             │
│  MAYA (System Prompt) reasons:                                              │
│  • "wife" → adults = 2                                                      │
│  • "week" → 7 nights, pick next available Saturday                          │
│  • "Toronto" → YYZ (exact match)                                            │
│  • "$4000" → ~$1800 flights + $2200 hotel = ~$314/night                     │
│  • "Cancún" → destination = CUN                                             │
│  • cabinClass = economy (default)                                           │
└─────────────────────────┬───────────────────────────────────────────────────┘
                          │ Claude decides to call 4 tools IN PARALLEL
                          │
          ┌───────────────┼──────────────────┬────────────────────┐
          ▼               ▼                  ▼                    ▼
┌──────────────┐ ┌──────────────────┐ ┌──────────────┐ ┌────────────────────┐
│searchFlights │ │  searchHotels    │ │  searchExp.  │ │ getDestinationGuide│
│              │ │                  │ │              │ │                    │
│origin: YYZ   │ │dest: Cancun      │ │dest: Cancun  │ │dest: Cancun        │
│dest:   CUN   │ │checkIn: [date]   │ │category: all │ │                    │
│depart: +2wks │ │checkOut: +7 days │ │limit: 6      │ │timeout: 12s        │
│adults: 2     │ │adults: 2         │ │              │ │(Gemini API)        │
│infants: 0    │ │maxPrice: $314    │ │timeout: 8s   │ │                    │
│cabin: economy│ │                  │ │              │ │                    │
│timeout: 15s  │ │timeout: 10s      │ │              │ │                    │
└──────┬───────┘ └────────┬─────────┘ └──────┬───────┘ └─────────┬──────────┘
       │                  │                   │                    │
       ▼                  ▼                   │                    │
┌──────────────┐ ┌──────────────────┐         │                    │
│  AGGREGATOR  │ │   AGGREGATOR     │         │                    │
│ aggregator.ts│ │  aggregator.ts   │         │                    │
│              │ │                  │         │                    │
│ Duffel API   │ │  LiteAPI search  │         │                    │
│ POST /offer_ │ │  POST /hotels/   │         │                    │
│ requests?    │ │  rates           │         │                    │
│ return_offers│ │                  │         │                    │
│ =true        │ │  (Amadeus hotels │         │                    │
│              │ │   disabled)      │         │                    │
│ [8s hard cap]│ │  [10s cap]       │         │                    │
└──────┬───────┘ └────────┬─────────┘         │                    │
       │                  │                   │                    │
       ▼                  ▼                   │                    │
┌──────────────┐ ┌──────────────────┐         │                    │
│ RANKING AGENT│ │  Hotel results   │         │                    │
│ ranking.ts   │ │  sorted by price │         │                    │
│              │ │                  │         │                    │
│ Score formula│ │  If 0 results:   │         │                    │
│ Price  (40%) │ │  → sampleHotels()│         │                    │
│ Flex   (30%) │ │  (isSample=true) │         │                    │
│ Duration(20%)│ │                  │         │                    │
│ Stops  (10%) │ │                  │         │                    │
│              │ │                  │         │                    │
│ Bookable     │ │                  │         │                    │
│ (Duffel)     │ │                  │         │                    │
│ first        │ │                  │         │                    │
└──────┬───────┘ └────────┬─────────┘         │                    │
       │                  │                   └────────────────────┘
       └──────────────────┴────────────────────────────────────────┐
                                                                    │ All 4 results
                                                                    ▼ injected as tool results
┌───────────────────────────────────────────────────────────────────────────────┐
│  CLAUDE (Maya) streams response                                               │
│                                                                               │
│  "Found 3 great Cancún options for you and your partner! ✈️"                 │
│  [FLIGHT_CARD] { AC123, YYZ→CUN, $842, economy, 4h 30m, non-stop, ... }     │
│  [FLIGHT_CARD] { WS456, YYZ→CUN, $910, economy, 6h 15m, 1-stop YYC, ... }   │
│  [FLIGHT_CARD] { UA789, YYZ→CUN, $956, economy, 5h 45m, 1-stop ORD, ... }   │
│  "And here are beautiful hotels that fit your ~$300/night budget:"           │
│  [HOTEL_CARD] { Moon Palace, 5★, $285/night, beach resort, ... }            │
│  [HOTEL_CARD] { Hyatt Zilara, 5★, $295/night, adults-only, ... }            │
│  [HOTEL_CARD] { Riu Palace, 4★, $195/night, family-friendly, ... }          │
│  [EXPERIENCE_CARD] × 6 (Chichen Itza, snorkeling, cenotes, etc.)            │
│  "Just a flat $20 service fee — no surprises. Which catches your eye?"       │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                   User clicks "Select" on AC123 flight
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  CHAT PAGE  ·  handleSelectFlight()  ·  app/chat/page.tsx                    │
│                                                                               │
│  setCartFlight(f)                    ← React state                           │
│  [BUG] sessionStorage NOT written   ← ⚠️ The checkout bug                   │
│  append({ role:'user',               ← Sends [FLIGHT_SELECTED] message       │
│    content: '[FLIGHT_SELECTED] Air Canada YYZ→CUN...' })                     │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  CLAUDE (State Machine: FLIGHT_CHOSEN)                                        │
│                                                                               │
│  "Perfect choice — Air Canada non-stop is excellent!"                        │
│  "Your hotel options are just above — scroll up and pick one!"               │
│  [STOPS — zero tool calls, no re-listing]                                    │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                   User clicks "Select" on Moon Palace hotel
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  CHAT PAGE  ·  handleSelectHotel()  ·  app/chat/page.tsx                     │
│                                                                               │
│  setCartHotel(h)                                                             │
│  sessionStorage.setItem('ft_cart', {                                         │
│    flight: cartFlight,   ← reads React state (set earlier)                   │
│    hotel: h,                                                                 │
│    children: cartChildren,                                                   │
│    savedAt: Date.now(),                                                      │
│    sessionId: getSessionId()                                                 │
│  })                                                                          │
│  → "Proceed to Checkout" CTA appears                                         │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                   User clicks "Proceed to Checkout"
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  CHECKOUT PAGE  ·  app/booking/page.tsx                                       │
│                                                                               │
│  1. Reads ft_cart from sessionStorage                                        │
│  2. Stale check: if savedAt > 4 minutes → show warning                      │
│  3. Renders <CheckoutCard flight hotel sessionId />                          │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  CHECKOUT CARD  (4 phases)  ·  components/CheckoutCard.tsx                   │
│                                                                               │
│  Phase 1 — REVIEW                                                            │
│    Trip summary, passenger count controls (+/- adults/children)              │
│                                                                               │
│  Phase 2 — PASSENGERS                                                        │
│    Form per adult: firstName, lastName, DOB, email, phone                    │
│    Form per child: firstName, lastName, DOB                                  │
│    [Missing: title, gender — hardcoded 'mr'/'m' later in backend]           │
│                                                                               │
│  Phase 3 — INVOICE                                                           │
│    Full cost breakdown:                                                      │
│    • Flight: $842.00 (2 adults, economy)                                    │
│    • Hotel: $1,995.00 (7 nights × $285)                                     │
│    • Service fee: $20.00                                                     │
│    • Total: $2,857.00                                                        │
│    "Pay $20 →" button (only Stripe $20 service fee charged here)            │
│                                                                               │
│  Phase 4 — PAYMENT                                                           │
│    POST /api/stripe/prepare → creates $20 PaymentIntent                     │
│    Stripe Elements UI for card entry                                         │
│    On confirmPayment success → triggers booking                              │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │ POST /api/book-trip
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  BOOKING CONTROLLER  ·  app/api/book-trip/route.ts                           │
│                                                                               │
│  1. JSON schema validation (Zod)                                             │
│  2. Placeholder ID detection                                                 │
│  3. Stripe PaymentIntent verification (status must = 'succeeded')           │
│  4. Calls orchestrator.book()                                                │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR  ·  lib/orchestrator/index.ts                                   │
│                                                                               │
│  book(req) →                                                                 │
│    bookingAgent.book(req) (see below)                                        │
│    _persistBooking() → Supabase REST:                                        │
│      • trips table: session, route, dates                                    │
│      • bookings table: provider_ref, booking_ref, amount, flexibility        │
│      • events table: raw webhook payloads                                    │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                              ┌─────────────────────┴────────────────────────┐
                              │                                               │
                              ▼ (parallel)                                    ▼ (parallel)
┌─────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│  DUFFEL FLIGHT BOOKING                  │  │  LITEAPI HOTEL BOOKING                  │
│  lib/agents/booking.ts                  │  │  lib/agents/booking.ts                  │
│                                         │  │                                         │
│  1. Fetch live offer:                   │  │  1. liteApiGetFreshOfferId()            │
│     GET /air/offers/{offerId}           │  │     (refreshes rate if hotelId known)   │
│  2. Stale-rate check:                   │  │  2. liteApiPrebook():                   │
│     live price vs requestedPriceCents   │  │     POST /rates/prebook                 │
│     tolerance: ±$1.00                   │  │     → returns prebookId                │
│  3. Map passengers:                     │  │  3a. SANDBOX: liteApiBook():            │
│     adults → { title:'mr', gender:'m' } │  │      POST /rates/book                  │
│     [BUG: hardcoded title/gender]       │  │      → hotelRef returned               │
│  4. POST /air/orders                    │  │  3b. PRODUCTION:                       │
│     timeout: 30s                        │  │      requiresHotelPayment=true         │
│     [ISSUE: should be 60-90s]           │  │      returns secretKey + transactionId  │
│  5. On 422 → refreshDuffelOffer()       │  │      frontend shows LiteAPI SDK widget  │
│     auto-retry once                     │  │                                         │
│  6. Returns:                            │  │  4. Returns:                            │
│     flightRef (PNR)                     │  │     hotelRef (booking ID)              │
│     flexibilityScore                    │  │                                         │
│     totalAmount + currency              │  │                                         │
└─────────────────────┬───────────────────┘  └──────────────────────┬──────────────────┘
                      │                                              │
                      └──────────────────────┬───────────────────────┘
                                             │
                                             ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  RESPONSE TO FRONTEND                                                         │
│                                                                               │
│  {                                                                            │
│    success: true,                                                             │
│    flightRef: "ABC123",        ← Duffel PNR (airline booking reference)      │
│    hotelRef:  "LTA-987654",    ← LiteAPI booking ID                          │
│    flexibilityScore: { score: 0.82, label: "Flexible", summary: "..." },     │
│    isSandboxBooking: true                                                     │
│  }                                                                            │
└───────────────────────────────────────────────────┬───────────────────────────┘
                                                    │
                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  BOOKING PAGE — SUCCESS SCREEN  ·  app/booking/page.tsx                      │
│                                                                               │
│  "Booking confirmed! ✈️ Air Canada ABC123 · 🏨 Moon Palace LTA-987654"       │
│  Flexibility badge shown                                                     │
│  Print itinerary button                                                      │
│  Stripe receipt link                                                         │
└───────────────────────────────────────────────────────────────────────────────┘

PARALLEL STRIPE WEBHOOK (async):
POST /api/webhooks/stripe ← Stripe sends payment_intent.succeeded
  → verifies HMAC signature
  → updates payments table: status='succeeded'
  → updates bookings table: status='confirmed'

PARALLEL DUFFEL WEBHOOK (async, if configured):
POST /api/webhooks/duffel ← Duffel sends order.created
  → currently: stores in events table only
  → [MISSING]: no airline_initiated_change_detected handler
```

---

## PART 3: System Prompt Deep Critique

### The Full Prompt Text Location
`app/api/chat/route.ts` → `buildSystem()` function — the prompt Maya uses.

---

### CRITIQUE 1: Prompt Does Too Many Jobs (Cognitive Overload)

**Problem:** The single `buildSystem()` prompt handles personality, routing logic, state machine transitions, complex destination-specific rules (Dubai areas, COK routes, Pacific routing), error handling, card format spec, compliance rules, and UX copy. It's approximately 2,200 words — far too long for a production AI system where every token matters with `maxTokens: 2500`.

The prompt consumes ~600-700 tokens on every single request, leaving only ~1,800 tokens for the actual response including card JSON. A single `[FLIGHT_CARD]` with full segments array is ~300 tokens. Three flight cards + three hotel cards = ~1,800 tokens → almost no room for Claude's own words.

**Critique:** The prompt is at constant risk of producing truncated responses (cards cut off mid-JSON) or Claude having to choose between showing fewer cards and having meaningful conversation.

**Fix:** Split into a short "personality + core rules" system prompt (~300 tokens) and inject destination-specific, search-specific, and state-specific rules dynamically based on conversation state.

---

### CRITIQUE 2: Anti-Hallucination Rules Are Buried

**Problem:** The most critical guardrails (NEVER fabricate IDs, NEVER assume origin airport) appear at lines ~100 and ~165 of the prompt — buried after 1,200+ words of personality, IATA codes, and routing logic. LLMs weight recent context more heavily; rules at the bottom of a long prompt are more likely to be followed than rules in the middle.

**Critique:** The "ANTI-HALLUCINATION" and "CRITICAL GUARDRAILS" sections should be at the TOP of the system prompt, before any personality or style instructions. Critical safety rules should never compete with persona for attention.

---

### CRITIQUE 3: The State Machine Is Fragile

**Problem:** The state machine relies on the AI detecting `[FLIGHT_SELECTED]` and `[HOTEL_SELECTED]` tags in user messages. These are injected by the frontend but could be:
- Missed if the AI's context window is compressed (last 6 messages kept, per CLAUDE.md)
- Confused by a user who literally types "[FLIGHT_SELECTED]" themselves
- Not triggered if the state transition message is trimmed during compression

**Critique:** State transitions should be handled server-side (a `state` field in the API request), not inferred from user message content. The AI shouldn't need to detect its own UI state from chat text.

---

### CRITIQUE 4: Routing Rules Are Hardcoded and Fragile

**Problem:** The COK (Kochi) and Pacific routing sections contain hardcoded airline hub assumptions:
- "COK to North America: always Pacific route via Asian hubs (SIN, BKK, NRT, HKG, ICN)"
- Pacific routing filter blocks all DEL, BOM, DXB, DOH, AUH, LHR, CDG, etc.

**Critique:** These are not universal truths — they're preferences. Air India does route COK→YYZ via DEL. Emirates routes COK→NYC via DXB. By telling the AI to block these, you're hiding valid, sometimes cheaper, options from users. The AI should present options and let users filter, not silently suppress entire routing categories.

---

### CRITIQUE 5: No Regulatory/Compliance Instructions

**Problem:** The system prompt contains zero mention of:
- 24-hour cancellation rights (US DOT)
- Baggage fee disclosure (US DOT)
- TSA Secure Flight data (gender/DOB required for US flights)
- Canadian APPR passenger rights
- Operating carrier disclosure for codeshares

**Critique:** A booking platform's AI should proactively mention compliance-relevant information. For example, when showing a non-refundable fare, it should mention "US law gives you 24 hours to cancel free if you booked 7+ days before departure." This is both good UX and regulatory protection.

---

### CRITIQUE 6: Budget Estimation Logic Is Flawed

**Problem:** The prompt says:
```
"$4000 total for 7 nights = ~$2250 flights + ~$2750 hotels ≈ $390/night max"
```
That math is wrong: $2,250 + $2,750 = $5,000, not $4,000. The example in the prompt has an arithmetic error.

Also the static split ("~45% flights, ~50% hotel, ~5% fees") doesn't account for:
- Short-haul flights (Toronto → Montreal: $100, leaving more for hotels)
- Long-haul flights (Toronto → Tokyo: $1,800+, leaving less)
- Number of passengers (2 people vs 5 people radically changes the split)

**Critique:** The budget split formula should account for route distance and passenger count, or should be removed and let the AI reason about it contextually.

---

### CRITIQUE 7: Tool Descriptions Missing Critical Context

**`searchFlights` description:**
> "Search flights across Duffel + Amadeus in parallel. Returns best-priced options ranked cheapest first. Duffel results are bookable; Amadeus are price references only."

**Problem:** The AI doesn't know which results are bookable vs reference until it sees the `provider` field. The description implies Amadeus results will always appear alongside Duffel, but Amadeus is disabled. This could confuse the model when explaining to users why "some options can't be booked online."

**`getDestinationGuide` description:**
> "Get a concise travel guide from Claude AI..."

**Problem:** The AI (Claude) calling a tool that's described as "Claude AI" is confusing. It's actually calling Gemini. This description is factually wrong and could cause Claude to treat the output with inappropriate trust/authority.

**`searchHotels` response injection:**
The tool injects a forced instruction: `"IMPORTANT: You MUST emit exactly ${hotels.length} [HOTEL_CARD] tags"` into tool results. This is clever but it means the AI is being instructed mid-stream from what appears to be tool data — which is technically a form of prompt injection from your own system.

---

### CRITIQUE 8: The Prompt Has No Error Recovery Strategy

**Problem:** The prompt says "NEVER call any tool more than once per response — no retry loops" but provides no guidance on what to do when search results are unhelpful, ambiguous, or partial.

If Duffel returns 10 very expensive flights and LiteAPI returns 0 hotels, the prompt tells the AI to fall back to sample hotels and note "indicative pricing." But it doesn't tell the AI how to handle the case where the user specifically needs real hotel availability for a specific date (not samples).

**Critique:** The error recovery section needs to be more nuanced — a simple "tell user what happened and suggest alternatives" is insufficient for production.

---

### CRITIQUE 9: Personality Persona Creates Compliance Risk

**Problem:** Maya's persona instruction says:
> "Proactively flag: 'This rate is non-refundable — want me to check for a flexible option?' or 'That hotel is near the beach — great for your kids!'"

And:
> "When you see a great deal, call it out enthusiastically but honestly."

**Critique:** Encouraging the AI to make subjective "great deal" assessments creates risk. What is "enthusiastically but honestly"? This is subjective and could lead to:
- Overstating deals that aren't actually good value
- Recommending specific options in ways that could be perceived as steering
- FTC concerns around AI-generated endorsements without disclosure

The persona should be warm but factual, not promotional.

---

### CRITIQUE 10: maxSteps: 2 Creates Hard Limits

**Problem:** `maxSteps: 2` means Claude can only do 2 rounds of tool calls. This works for simple queries but breaks for:
- "Show me flights next week if not available, try the week after" — would require 2 tool calls (week 1 fails, week 2 search)
- Multi-city trips ("YYZ to Paris then Rome") — would need at least 3-4 tool calls
- "Search nearby hotels too" — requires the initial search + searchNearbyHotels call

With `maxSteps: 2`, Claude is constrained to either: call all tools in one batch (which it's instructed to do), or call tools in 2 rounds maximum.

**Critique:** For a travel concierge, `maxSteps: 4` would be more appropriate with a stricter instruction that parallel batch = step 1, any follow-up = step 2 max.

---

## PART 4: Additional Regulatory Gaps (Deeper Scan)

### R1. No Ticket Price Transparency for Children (US DOT)
US DOT requires that when a different fare applies to a child, it must be disclosed. The system currently falls back to adult pricing for children with a `childFareNote` disclosure in the AI response — but this note is not shown in the checkout invoice. A user could reach payment without knowing they were shown adult pricing for their child's seat.

### R2. No Codeshare Operating Carrier Disclosure (US DOT 14 CFR 257)
When an Air Canada flight is marketed as "AC123" but operated by Jazz Aviation (a regional partner), passengers must be informed of the operating carrier. The codebase only stores and displays `marketing_carrier` — the `operating_carrier` field from Duffel is never mapped.

### R3. No Contact Information for Complaints (US DOT 14 CFR 259.7)
US DOT requires that booking agents prominently display contact information for customer complaints. No contact information or complaints link is visible in the checkout flow or confirmation page.

### R4. Privacy Policy Not Linked at Point of Data Collection
Canada's PIPEDA and US state privacy laws (CCPA for California users) require that a privacy policy be accessible at the point where personal information is collected. The passenger form in CheckoutCard.tsx has no privacy policy link or consent checkbox before submitting PII (name, DOB, email, phone) to the server.

### R5. No Terms of Service Acceptance at Booking
There is no explicit acceptance of terms of service during the checkout flow. US consumer protection and Canadian consumer protection laws require that users acknowledge they understand the booking terms (including the $20 non-refundable service fee, cancellation policies, etc.) before being charged.

### R6. Stripe Charge Description Doesn't Match US DOT Full-Fare Requirement
The Stripe PaymentIntent description is: "FlexeTravels — [flight description] fare $X + service fee $20 = $total". For Stripe receipts, users see only the $20 service fee charge. The actual flight and hotel charges happen outside Stripe (via Duffel balance + LiteAPI). A user's credit card statement will show only "$20 FlexeTravels" — not the total trip cost. This could trigger chargebacks from confused customers.

### R7. No Confirmation Email with Full Itinerary
US DOT 14 CFR 259.5 requires that booking confirmations be sent to the customer's email address with full itinerary details including: operating carrier, flight number, origin/destination, departure times, and booking reference. The codebase shows a success screen but there is no code to send a confirmation email.

### R8. Children Under 15 Unaccompanied Minor Rules Not Enforced
US DOT and airline policies require special handling for Unaccompanied Minors (typically children under 15 traveling without an adult). The codebase allows child passengers to be booked without requiring a corresponding adult, and there's no check that prevents booking a solo child passenger.

### R9. No Display of Fare Basis Code or Fare Rules
IATA Resolution 724 and US DOT full-fare advertising requirements indicate that fare rules (the binding terms of the ticket) should be accessible to passengers. Duffel returns conditions as structured data, but the full fare rules text is never shown — only the simplified Flexible/Moderate/Locked badge.

### R10. ADA/Accessibility — No Screen Reader Compliance
US law (Air Carrier Access Act) and Canada's Accessible Transportation for Persons with Disabilities Regulations require that digital booking tools be accessible to people with disabilities. The flight card and hotel card UI has not been audited for WCAG 2.1 compliance, and the custom JSON card rendering in ChatMessage.tsx may not be screen-reader accessible.

---

## PART 5: Summary of All Regulatory Issues

| # | Issue | Regulation | Severity |
|---|-------|-----------|---------|
| 1 | 24-hr free cancellation not disclosed | US DOT 14 CFR 259.5 | HIGH |
| 2 | No 24-hr cancellation capability | US DOT 14 CFR 259.5 | HIGH |
| 3 | Refund loop: Duffel refunds to balance, not customer card | Consumer protection | HIGH |
| 4 | Hardcoded gender 'M' for all passengers | TSA Secure Flight 49 CFR 1560 | HIGH |
| 5 | No baggage allowance displayed | US DOT 14 CFR 399.85 | HIGH |
| 6 | No operating carrier disclosure | US DOT 14 CFR 257 | HIGH |
| 7 | No confirmation email sent | US DOT 14 CFR 259.5 | HIGH |
| 8 | No privacy policy at PII collection | PIPEDA (CA) / CCPA (US-CA) | HIGH |
| 9 | No T&C acceptance before charge | US/CA consumer protection | MEDIUM |
| 10 | Child pricing not disclosed in invoice | US DOT | MEDIUM |
| 11 | No complaint contact information | US DOT 14 CFR 259.7 | MEDIUM |
| 12 | Stripe receipt shows only $20, not total | Consumer protection | MEDIUM |
| 13 | No APPR rights disclosure (Canadian flights) | Canada APPR | MEDIUM |
| 14 | No APIS/passport collection (international) | US CBP / Canada CBSA | MEDIUM |
| 15 | Unaccompanied minor not flagged | IATA / airline policy | MEDIUM |
| 16 | No fare rules / fare basis accessible | IATA Res 724 / DOT | LOW |
| 17 | No ADA/accessibility audit | ACAA / ATPDR | LOW |
| 18 | guestNationality defaults 'CA' for all | Factual accuracy / LiteAPI rates | LOW |
