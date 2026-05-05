# FlexeTravels Payment Architecture

Last updated: 2026-05-03

## Business posture

FlexeTravels and Tours Inc. is a Canadian company preparing for BC travel licensing. The product is intentionally transparent:

- Flight fare is shown as supplier fare.
- FlexeTravels service fee is shown separately.
- Customer sees the total charged today before entering card details.
- FlexeTravels can be merchant of record where required by the payment rail.

## Payment strategies

The app must route payment by market, supplier, and provider capability. There is no single universal checkout flow.

```text
Checkout cart
   |
   v
Quote / Payment Strategy Router
   |
   +-- duffel_payments_markup
   |     Duffel collects fare + Flexe fee and funds/payments reconcile inside Duffel.
   |
   +-- stripe_balance
   |     Stripe collects fare + Flexe fee.
   |     FlexeTravels books with Duffel Balance.
   |
   +-- razorpay_balance
   |     Razorpay collects fare + Flexe fee for India.
   |     FlexeTravels books with supplier balance.
   |
   +-- supplier_direct
         FlexeTravels collects only fee.
         Supplier/hotel gateway collects fare separately.
```

## Current implementation

### Canada launch path

```text
Canadian customer
   |
   v
Stripe PaymentIntent = verified Duffel flight fare + FlexeTravels service fee
   |
   v
Stripe succeeds
   |
   v
/api/book-trip verifies:
  - PaymentIntent succeeded
  - amount matches metadata.expected_amount
  - currency matches metadata.expected_currency
  - selected offer IDs match metadata.flight_offer_ids
   |
   v
Duffel order created with payment.type = balance
```

This is the right launch path when FlexeTravels is merchant of record and pays Duffel from Balance.

### Supplier-direct path

Hotels and future supplier-direct rails can still charge separately. In that case the customer should see:

```text
Charged now:
  FlexeTravels service fee

Charged separately:
  Hotel/supplier fare through secure supplier gateway
```

## Code map

- `lib/payments/strategy.ts` — pure payment strategy and quote math.
- `app/api/checkout/quote/route.ts` — non-mutating quote preview endpoint.
- `app/api/stripe/prepare/route.ts` — creates Stripe PaymentIntent for the selected strategy.
- `app/api/book-trip/route.ts` — verifies Stripe PaymentIntent before supplier booking.
- `components/CheckoutCard.tsx` — renders transparent fare + fee + settlement copy.
- `lib/db/schema-payments.sql` — planned ledger/idempotency migration for production reconciliation.
- `docs/END-TO-END-TESTING.md` — manual QA + payment/supplier validation runbook.

## Provider expansion model

Future Amadeus / Travelport work should plug into a supplier interface, not into Duffel-specific checkout code.

```typescript
interface TravelSupplier {
  searchFlights(params): Promise<NormalizedOffer[]>
  priceOffer(offerId): Promise<PricedOffer>
  createBooking(quote, passengers): Promise<BookingResult>
  cancelBooking(ref): Promise<CancelResult>
  getRules(offerId): Promise<FareRules>
}
```

Normalized supplier fields needed before checkout:

- provider
- offer id
- live price
- currency
- expires at
- payment capability
- refund/change rules
- baggage disclosure
- booking location restrictions

## Required hardening before scale

1. Apply `lib/db/schema-payments.sql`.
2. Add automatic refund path for paid-but-not-booked failures.
3. Add Duffel Balance threshold guard. Initial float target: `$10k`; alert/block threshold should be configurable.
4. Add Duffel Payments path as a separate strategy once live component behavior is tested.
5. Add Razorpay Balance strategy for India.
6. Add provider-specific reconciliation views in admin.

## Ledger tables

```text
payment_quotes
  immutable customer-facing quote, selected strategy, offer IDs, cart hash

payment_transactions
  Stripe/Razorpay/Duffel payment object, expected amount/currency, status

supplier_bookings
  one row per supplier booking attempt, per leg and product

ledger_entries
  money movement across customer cash, Stripe, Duffel Balance, revenue, refunds
```

This separates the financial truth from transient UI state. It also gives support a way to answer: what did we charge, what did we book, what failed, and what refund is owed?

## Runtime ledger behavior

When `lib/db/schema-payments.sql` is applied:

1. `/api/stripe/prepare` creates an `open` `payment_quotes` row before creating the Stripe PaymentIntent.
2. Stripe metadata receives `quote_id`, expected amount/currency, strategy, and pinned offer IDs.
3. `/api/book-trip` consumes the quote with `status = open` before supplier booking. A replayed quote returns 409.
4. `/api/book-trip` writes:
   - `payment_transactions` for the Stripe PI
   - `supplier_bookings` for every attempted flight/hotel leg
   - `ledger_entries` for Stripe cash, supplier payable, and service-fee revenue

If the migration has not been applied yet, these writes soft-fail and the current booking flow still works. That makes the rollout safe but means true cross-process idempotency starts only after the migration is live.

## Complex checkout scenarios to test

- One flight, USD fare, Stripe Balance, 2 adults.
- One flight, CAD fare, Stripe Balance, service fee converted from USD to CAD.
- Two flights same currency, Stripe Balance, one PaymentIntent, two Duffel orders.
- Two flights mixed currencies, checkout blocked or split into separate payment groups.
- Flight + hotel, hotel paid through LiteAPI gateway, flight collected through Stripe Balance.
- Stripe payment succeeds, Duffel booking fails, auto-refund/failure workflow.
- Stripe payment succeeds, first leg books, second leg fails, partial refund workflow.
- User changes cart after quote creation, stale quote rejected.
- PaymentIntent amount tampered by client, `/api/book-trip` rejects.
- Offer ID changed after payment, `/api/book-trip` rejects.

## Complex chat queries to regression-test

- "Family of 5 from Vancouver, kids are 1, 4, and 8, somewhere warm in May under $5k, direct if possible."
- "BLR to YVR end of May, avoid Air India, only via Europe or Pacific, one adult."
- "Two adults from Toronto to Cancun for 6 nights, kid-friendly resort, refundable flight preferred."
- "Canada to India in business class but no Middle East connection, compare price vs comfort."
- "US customer, NYC to Paris, use the most flexible fare and show what cancellation rights apply."
- "India customer, Bangalore to Dubai with hotel, pay in INR if possible."
- "Multi-city: Vancouver to Tokyo 4 nights, Seoul 3 nights, back to Vancouver, no red-eyes."
- "Same trip but make it cheaper without changing hotel star rating."
