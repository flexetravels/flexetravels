# FlexeTravels Booking Funnel

> Last updated: 2026-05-24

## Release Scope

The live customer path is a simple booking funnel, not an AI-first concierge:

- `Flights` and `Hotels` tabs are visible immediately on the homepage.
- Flight-only and hotel-only searches both work without forcing the other product.
- The customer sees provider pricing, one flat `$20` FlexeTravels service fee, and applicable tax on that fee before payment.
- No hidden commission markup is added by FlexeTravels.

## Search APIs

### Flights

`POST /api/search/flights`

- Validates origin/destination IATA codes, dates, trip type, passengers, children ages, cabin, and filter params with Zod.
- Calls Duffel through the shared aggregator.
- Returns normalized flight offers with route, legs, fare variants, baggage, refund/change information, customer-safe public warnings, and latency.

### Hotels

`POST /api/search/hotels`

- Validates destination, dates, guests, rooms, children ages, and filter params with Zod.
- Calls LiteAPI through the shared aggregator.
- Returns normalized hotel results with rooms, rates, images, amenities, cancellation indicators, customer-safe public warnings, and latency.

Raw provider failures are logged on the server for support/debugging and are not returned to the browser. The customer sees a plain availability or retry message instead of provider names, fallback details, stack traces, or internal identifiers.

## Cart Contract

Selected items are stored in `sessionStorage('ft_cart')`.

For flights, the Duffel `offerId` is the source of truth. The cart keeps:

- selected offer id
- fare brand/variant
- airline, route, legs, dates, passengers, cabin
- displayed fare, currency, and selected timestamp
- baggage/refundability/change information
- customer-facing fare terms and caveats

For hotels, the cart keeps:

- hotel id and selected rate id
- selected room/rate name
- displayed nightly and total price
- cancellation and meal-plan indicators
- selected images and property details when available

## Flight Fare Terms

Fare conditions are normalized through a customer-terms layer:

1. Duffel structured conditions when returned.
2. Airline fare-family knowledge base when Duffel does not expose enough detail.
3. Route/cabin/fare-brand mapping where the fare brand is meaningful.
4. Confidence/source labels for every claim.
5. Simple customer wording for checkout acknowledgement.

Customer UI should prefer clear, protective wording:

- `Confirmed` when returned by Duffel.
- `Based on airline fare-family guidance` when inferred from fare-family rules.
- `Exact rule unavailable` when not enough data is available.
- `We'll confirm before you proceed` when only knowable during a future change/cancel request.

The UI must not claim a fare is refundable or changeable unless the provider data or fare-family source supports that statement.

## Hotel Room Transparency

Hotel room cards separate image browsing from booking selection:

- Clicking a room thumbnail opens the image lightbox.
- Clicking `Select this room` chooses the room/rate.
- Room rows show refundable and breakfast indicators when available.
- Price rows show the difference vs the lowest visible room rate when there is a price gap.

Filters only appear when the current search results contain matching data. Clickable filter controls must always change the result set or be hidden.

## Checkout, Payment, And Taxes

Stripe setup is payment-first:

1. Customer selects a flight or hotel.
2. Checkout displays the selected offer/rate, fare terms, passenger details, provider fare, service fee, and tax.
3. `/api/stripe/prepare` re-fetches the selected Duffel offer by id when a flight is selected.
4. Stripe charges the verified fare plus the `$20` FlexeTravels fee plus applicable tax on the FlexeTravels fee.
5. `/api/book-trip` verifies the PaymentIntent status, amount, currency, offer id, fare amount, fee, and tax metadata before creating provider bookings.

The legacy direct `/api/book` route is retired by default and must not be used for customer checkout. Production bookings go through `/api/stripe/prepare` and `/api/book-trip` so the provider fare plus the FlexeTravels fee and applicable service-fee tax are paid and verified before Duffel or LiteAPI booking calls run.

Provider fares returned by Duffel/LiteAPI already include provider-visible taxes and fees. FlexeTravels calculates sales tax only on the FlexeTravels service fee. Canadian billing regions use province-specific GST/HST/PST-style rules in `lib/tax.ts`; US billing currently applies `0%` in-app sales tax until a tax nexus rule is configured.

## Customer-Facing Error Boundaries

Provider, model, and payment errors are logged server-side with enough detail for support and debugging. Browser responses must stay customer-safe: no raw provider names in error strings, no stack traces, no API payload fragments, no internal fallback details, and no raw model or Stripe exception messages.

## Records And Customer Receipts

The booking flow captures data needed for support and debugging:

- session id and booking reference
- Stripe PaymentIntent id, amount, currency, service fee, tax label, and tax amount
- Duffel offer id and flight order reference/PNR when issued
- LiteAPI hotel booking/prebook identifiers when returned
- selected fare terms and checkout caveats
- passenger/contact details required by the provider
- provider response metadata useful for support follow-up

Confirmation email includes customer-safe booking references, itinerary summary, amounts charged, selected fare terms, important caveats, and support contact details. Internal-only identifiers such as raw Duffel offer ids are not displayed as customer invoice line items.

## Deployment

Railway auto-deploys on push to `origin main`.

Required production environment keys:

- `DUFFEL_ACCESS_TOKEN`
- `LITEAPI_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `NEXT_PUBLIC_APP_URL`

Live ticket issuance depends on Duffel live-mode access and funded Duffel balance. Live hotel booking depends on LiteAPI production access and the configured production payment flow.

## Verification Checklist

Before pushing:

- `npx vitest run __tests__/booking-funnel.test.ts`
- `npx tsc --noEmit`
- targeted `npm run lint -- --file ...`
- `npm run build`

Routine tests stop before submitting a real card payment or creating a live booking unless the owner explicitly approves a live transaction.
