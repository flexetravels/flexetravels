# FlexeTravels Live Booking Readiness Spec

Last updated: 2026-05-27

## Purpose

This spec defines the requirements, design, and task list required before FlexeTravels allows a real customer to complete a live flight booking on the published website.

The goal is not only that the UI looks ready. The goal is that search, selection, payment, supplier booking, confirmation email, database records, audit trail, and recovery paths are all verifiably correct.

## Current Status Snapshot

Related rehearsal runbook: `docs/LIVE_BOOKING_REHEARSAL.md`.

Latest reviewed local commit: `85ec593 test: cover booking confirmation emails`.

Recently completed:

- Duffel balance threshold guard before Stripe payment setup and supplier booking.
- Customer-safe mapping for low supplier balance and booking failures.
- Confirmation email unit test with mocked SMTP transport.
- Support lookup dashboard by session id, email, Stripe PaymentIntent id, quote id, booking reference, PNR, and supplier id.
- Support dashboard `Recent Activity` path so an admin can begin without already knowing a customer identifier.
- Backend/type/build verification for the latest local commit.

Still blocking live rehearsal:

- Railway production env vars must be verified by an authenticated Railway CLI session or in the Railway dashboard.
- Latest pushed commit must be confirmed live on Railway. The last check still showed the previous `/admin/support` build without `Recent Activity`.
- SMTP production delivery must be tested against a real inbox.
- A build/version endpoint should be added so support can prove which commit Railway is serving.
- Controlled live booking rehearsal has not yet been run.

## Scope

Included:

- Flight-first live booking readiness.
- Hotel-only readiness where it affects checkout, logging, or combined carts.
- Direct homepage search analytics.
- Stripe PaymentIntent verification.
- Duffel ticket issuance through balance-funded booking.
- Customer confirmation and internal support records.
- Required backend, frontend, E2E, security, and production canary gates.

Not included:

- AI trip planning improvements.
- New supplier integrations beyond Duffel and LiteAPI.
- Full admin CRM redesign.
- Automated live card charging without owner approval.

## Core Principles

- Provider offer IDs are server-trusted, not browser-trusted.
- The browser may display a selected offer, but the server must re-price and verify it before charging or booking.
- The customer sees the provider fare, FlexeTravels service fee, applicable tax on that fee, and what is charged now.
- Internal identifiers, stack traces, provider fallback errors, and raw exception messages are never shown to customers.
- Every meaningful funnel step is persisted for support, debugging, conversion analysis, and dispute resolution.
- Tests are separated by layer and all required gates must pass before production deploy.

## Requirements

### R1. Production Change Freeze

Before live customer booking is enabled, production changes must be limited to critical fixes and explicitly reviewed release work.

Acceptance criteria:

- `main` and production deploys require a documented release checklist.
- Non-critical UI experiments are paused during live booking readiness.
- Any production push records the tested commit hash and test results.

### R2. Mandatory CI Release Gate

Production deployment must be blocked unless the required backend, frontend, build, and security checks pass.

Required gates:

- `npx tsc --noEmit`
- `npm run build`
- backend/domain tests with Vitest
- Playwright desktop checkout/search/security tests
- Playwright mobile viewport smoke tests
- security hardening tests
- targeted lint for changed files

Acceptance criteria:

- CI fails the deployment when any required gate fails.
- Existing repo-wide lint debt is either fixed or isolated so new changes cannot add more debt.
- Test output is linked from the release record.

### R3. Direct Search Session Logging

Every direct homepage search must create or update a durable user session and write a search log.

Covered endpoints:

- `POST /api/search/flights`
- `POST /api/search/hotels`

Acceptance criteria:

- Search request includes a stable `sessionId`.
- `user_sessions` is upserted before or during search handling.
- `search_logs` captures product type, parameters, provider, result count, latency, and safe error category.
- Search logs do not store raw secrets, full provider payloads, or customer payment data.
- A Playwright or API integration test proves: homepage search -> session row -> search log row.

### R4. Search-To-Checkout Funnel Integrity

Selected results must be traceable from search to checkout and booking.

Acceptance criteria:

- Flight cart stores selected Duffel offer id, fare brand, cabin, route, passenger count, child ages, displayed fare, currency, fare terms, and selected timestamp.
- Hotel cart stores selected hotel id, rate id, room/rate name, cancellation/meal indicators, displayed nightly and total price, and selected timestamp.
- Checkout receives the same `sessionId` used for search.
- `search_logs.converted` is updated when a selected result proceeds to quote/payment.
- Tests prove tab switching between Flights and Hotels does not lose the other product search state in the same session.

### R5. Stripe-To-Duffel Booking Guard

No supplier booking may be created unless Stripe payment is verified server-side.

Acceptance criteria:

- `/api/stripe/prepare` re-fetches the selected Duffel offer by id.
- PaymentIntent amount equals verified fare plus FlexeTravels service fee plus applicable tax on the service fee.
- PaymentIntent metadata includes quote id, expected amount, expected currency, flight offer id, fare amount, service fee, tax amount, and session id.
- `/api/book-trip` verifies PaymentIntent status, amount, currency, metadata, and quote status before booking.
- If offer price, currency, availability, or validity changes, checkout blocks silent booking and requires customer action.
- Tests prove client-side offer id, amount, or currency tampering is rejected.

### R6. Idempotency And Duplicate Booking Protection

Retries, double-clicks, webhooks, and browser refreshes must not issue duplicate tickets.

Acceptance criteria:

- `payment_quotes` can only be consumed once.
- `payment_transactions` records each payment attempt by provider payment id.
- `supplier_bookings` enforces one successful supplier booking per PaymentIntent and product leg.
- Duplicate `/api/book-trip` calls return a safe already-processing/already-booked response.
- Tests prove duplicate submit cannot create duplicate Duffel orders.

### R7. Confirmation Email And Receipt Completeness

Customer email must contain all customer-safe information needed after payment and booking.

Acceptance criteria:

- Email is sent to the address entered by the lead passenger/customer.
- Email includes booking reference, Duffel order reference/PNR when available, itinerary, passenger summary, fare amount, service fee, service-fee tax, total charged, fare terms, baggage summary, refund/change caveats, and support contact.
- Email does not expose raw internal offer ids as customer invoice line items.
- Email status is stored for support debugging.
- Tests cover email payload creation without sending real email.

### R8. Supabase Audit Trail

Supabase must capture the complete funnel and financial trail needed for verification and behavior analysis.

Required tables:

- `user_sessions`
- `search_logs`
- `payment_quotes`
- `payment_transactions`
- `supplier_bookings`
- `ledger_entries`
- booking/customer communication tables used by the current app
- client/server error logs

Acceptance criteria:

- Every live booking has a session row, at least one search log row, quote row, payment transaction row, supplier booking row, and ledger entries.
- Failed booking attempts persist failure stage, safe error category, provider, and recovery status.
- Admin/support can reconstruct: search -> selected offer -> quote -> payment -> supplier booking -> email.
- Sensitive tables are not readable by anonymous clients.

### R9. Full Customer-Safe Error Boundary

Customer-facing errors must be clear, useful, and safe.

Acceptance criteria:

- No raw provider error, stack trace, API key fragment, fallback route, SQL error, or internal ID leaks to the browser.
- Server logs retain enough detail for support.
- Search failures show availability/retry messages.
- Payment and booking failures show next steps and support guidance.
- Security tests cover prompt injection, API input validation, payment tampering, and public endpoint disclosure.

### R10. Post-Deploy Canary Monitoring

Every production deploy must be followed by automated checks against the published website.

Acceptance criteria:

- Production root responds with HTTP 200.
- Search page renders desktop and mobile.
- Flight search API accepts a safe test/mock request.
- Hotel search API accepts a safe test/mock request.
- Checkout page can render a seeded cart.
- `/api/stripe/prepare` test-mode or mocked check validates payment setup shape without issuing a live booking.
- Canary records console errors, network failures, and screenshots.

## Design

### Data Flow

```text
Browser session
  |
  v
Stable ft_session id in localStorage
  |
  +--> POST /api/search/flights or /api/search/hotels
  |      |
  |      +--> validate input with Zod
  |      +--> upsert user_sessions
  |      +--> call Duffel/LiteAPI
  |      +--> write search_logs
  |      +--> return customer-safe normalized results
  |
  v
Select offer/rate
  |
  v
sessionStorage(ft_cart)
  |
  v
/booking
  |
  v
/api/stripe/prepare
  |
  +--> re-fetch Duffel offer
  +--> create immutable payment_quote
  +--> create Stripe PaymentIntent with trusted metadata
  |
  v
Stripe payment succeeds
  |
  v
/api/book-trip
  |
  +--> verify PaymentIntent and metadata
  +--> consume quote idempotently
  +--> create payment_transaction
  +--> create Duffel order from balance
  +--> create supplier_booking
  +--> create ledger_entries
  +--> send confirmation email
  +--> update session/search conversion
```

### Test Layers

Backend tests:

- Pure pricing, tax, fare split, cart serialization, and ledger math.
- API validation for search, checkout quote, Stripe prepare, and book-trip.
- Payment verification and idempotency.
- Supabase write behavior using mocks or a test database.

Frontend tests:

- Homepage tabs, search forms, filters, date pickers, mobile cards.
- Search result selection and cart persistence.
- Checkout review, passenger forms, invoice, card-charge totals, and error states.
- Desktop and mobile responsive rendering.

Integration/E2E tests:

- Search -> session -> search log.
- Select -> checkout -> prepare PaymentIntent.
- Tamper cart/payment -> server rejects.
- Duplicate book-trip -> no duplicate supplier booking.
- Confirmation email payload generated after successful booking.

Production canaries:

- Read-only or test-mode checks against the deployed site.
- No live card charge or supplier booking unless explicitly approved.

### Release Gate

Minimum pre-production command set:

```bash
npx tsc --noEmit
npx vitest run __tests__/booking.test.ts __tests__/booking-funnel.test.ts __tests__/security-hardening.test.ts __tests__/payment-ledger.test.ts
npx playwright test e2e/checkout-totals.spec.ts e2e/security.spec.ts e2e/flow.spec.ts e2e/visual.spec.ts --reporter=list
npm run build
```

Full launch gate also requires:

- mobile Playwright viewport checks
- Supabase schema verification
- Stripe test PaymentIntent verification
- Duffel test/live controlled booking rehearsal
- email payload verification
- production canary screenshots

## Task List

### Phase 1. Stop The Bleeding

- [x] Add a release checklist file that records commit, environment, test commands, and results.
- [ ] Block production deploys unless required CI checks pass.
- [ ] Decide whether Railway deploys from `origin/main` or `production/main`; document one source of truth.
- [ ] Add changed-file lint gate or clean existing lint debt.

### Phase 2. Analytics And Funnel Persistence

- [ ] Add tests for direct homepage flight search session persistence.
- [ ] Add tests for direct homepage hotel search session persistence.
- [ ] Add conversion tracking test from selected result to checkout quote.
- [ ] Add Supabase verification script for latest session funnel reconstruction.
- [ ] Add safe error category fields to failed search logs. Public warning sanitization exists, but durable safe error categories still need verification in `search_logs`.

### Phase 3. Payment And Supplier Booking Safety

- [ ] Add integration test for `/api/stripe/prepare` with verified Duffel offer shape.
- [ ] Add test for fare changed/expired state. A pure price/currency-change test exists; API/UI blocking behavior still needs coverage.
- [ ] Add test for PaymentIntent metadata mismatch rejection.
- [ ] Add duplicate `/api/book-trip` idempotency test.
- [ ] Add paid-but-not-booked recovery state and support instructions.
- [x] Add Duffel balance threshold guard before live booking.

### Phase 4. Customer Communication

- [x] Define confirmation email schema.
- [x] Add email payload unit tests.
- [ ] Store email send status and provider response id.
- [x] Include PNR/order reference, fare, fee, tax, terms, caveats, and support details.
- [ ] Add resend/support lookup path for failed emails.

### Phase 5. Admin And Support Observability

- [x] Build support query by session id, email, PaymentIntent id, booking reference, and PNR/order id.
- [ ] Show search logs, selected offer, quote, payment, supplier booking, ledger, email status, and errors in one support view. Search/quote/payment/supplier/ledger lookup exists; email status and full error timeline still need persistence and display.
- [ ] Add safe server error logging for provider failures.
- [ ] Add dashboard counts for failed searches, prepare failures, book-trip failures, and email failures.

### Phase 6. Frontend Readiness

- [ ] Add mobile viewport Playwright tests for flight cards, hotel cards, filters, date range picker, and checkout.
- [ ] Add tests that every visible filter changes results or is hidden.
- [ ] Add tests that Flights/Hotels nav preserves same-session search state.
- [ ] Add checkout UI tests for service-fee tax by billing province/state.
- [ ] Add visual snapshots for critical booking pages.

### Phase 7. Production Canary

- [ ] Add canary script for deployed root, search page, seeded checkout, console errors, and mobile rendering.
- [ ] Add safe test-mode `/api/stripe/prepare` canary.
- [ ] Add Supabase write/read canary for a synthetic non-customer session.
- [ ] Store canary output and screenshots per deploy.
- [ ] Alert on failed canary before any customer campaign runs.

### Phase 8. Controlled Live Rehearsal

- [ ] Confirm Stripe live keys, webhook, and settlement account.
- [ ] Confirm Duffel live access, balance funding, and booking permissions.
- [ ] Confirm confirmation email sender/domain.
- [ ] Run one owner-approved low-risk live booking.
- [ ] Verify Stripe charge, Duffel balance deduction, ticket issuance, PNR/order reference, email, Supabase rows, and ledger entries.
- [x] Document the rehearsal checklist and rollback/recovery plan.
- [ ] Document the actual rehearsal result after the live transaction.

## Definition Of Done

Live booking can be enabled only when:

- All required release gates pass.
- A direct search creates a session and search log.
- Checkout re-verifies the supplier offer before payment.
- Stripe amount and metadata are server-verified before supplier booking.
- Duplicate booking is prevented.
- Confirmation email is accurate and customer-safe.
- Supabase can reconstruct the full booking timeline.
- Production canary passes after deploy.
- One owner-approved controlled live rehearsal succeeds end to end.

## Open Decisions

- Whether hotel supplier-direct payment should remain separate in v1 or be routed into one unified checkout later.
- Whether US sales tax remains zero until formal nexus/tax advice is configured.
- Whether deployment source of truth should be `origin/main`, `production/main`, or a Railway-specific branch.
- Whether live booking should initially be hidden behind an admin feature flag.
