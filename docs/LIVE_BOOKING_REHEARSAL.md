# FlexeTravels Live Booking Rehearsal Runbook

Last updated: 2026-05-27

## Purpose

This runbook is the owner-approved checklist for the first controlled live booking rehearsal. It exists so the first real ticket is handled deliberately: verified fare, verified payment, verified supplier ticketing, customer email, Supabase audit trail, and support lookup.

Planned rehearsal:

- Route: BLR to YVR
- Date: June 19
- Traveller count: 1 adult
- Cabin: Premium economy
- Target option: approximately 19 hours total duration
- Booker: FlexeTravels owner/admin
- Passenger: relative/customer entered during checkout

## Current Blockers

- Railway production environment variables have not been verified from this workspace because the Railway CLI is not authenticated.
- The latest pushed commit must be verified on the live Railway site before rehearsal. `/admin/support` should show the `Recent Activity` button.
- SMTP production delivery must be verified before relying on customer confirmation emails.
- A public or protected build/version endpoint should be added so support can confirm exactly which commit Railway is serving.

## Pre-Rehearsal Environment Checklist

Confirm these variables are set in Railway for the production service. Do not paste secret values into chat or docs; record only set/missing status.

- `ADMIN_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `DUFFEL_ACCESS_TOKEN`
- `DUFFEL_BALANCE_BUFFER_CENTS`
- `LITEAPI_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Expected defaults/notes:

- `DUFFEL_BALANCE_BUFFER_CENTS` defaults to `5000` in code if not set.
- `SMTP_FROM` defaults to `FlexeTravels <bookings@flexetravels.com>` in code if not set.
- If SMTP host/user/pass are missing, `/api/send-confirmation` returns success with `skipped: true`, so no real confirmation email is sent.

## Pre-Rehearsal Code Gates

Run and record results:

```bash
npx tsc --noEmit
npx vitest run __tests__/booking.test.ts __tests__/booking-funnel.test.ts __tests__/duffel-balance.test.ts __tests__/payment-ledger.test.ts __tests__/security-hardening.test.ts __tests__/send-confirmation.test.ts
npm run build
```

Recommended before wider launch:

```bash
npx playwright test e2e/checkout-totals.spec.ts e2e/security.spec.ts e2e/flow.spec.ts e2e/visual.spec.ts --reporter=list
```

## Admin Dashboard Access

URL:

```text
https://flexetravels-production.up.railway.app/admin/support
```

Login flow:

1. Enter `ADMIN_SECRET`.
2. Click `Recent Activity` if you do not yet know the customer email, session id, PaymentIntent id, or PNR.
3. Identify the latest relevant search, quote, payment, or supplier booking.
4. Search the specific session id, customer email, Stripe PaymentIntent id, quote id, booking reference, PNR, or supplier booking id.
5. Confirm the timeline reconstructs the funnel: search -> quote -> payment -> supplier booking -> ledger/email status where available.

## Booking Rehearsal Steps

1. Open the live website in a clean browser session.
2. Search flights:
   - From: BLR
   - To: YVR
   - Date: June 19
   - Adults: 1
   - Cabin: Premium economy
3. Select the intended approximately 19-hour premium economy option.
4. Review the selected fare card:
   - Airline and route match.
   - Fare brand and customer terms are understandable.
   - Fare difference is explained if multiple fare families are shown.
   - Duffel offer id is not displayed to the customer.
5. Continue to checkout.
6. Enter passenger details exactly as travel document:
   - Legal first and last name
   - Date of birth
   - Gender, if required by the form/provider
   - Email address that should receive the confirmation
   - Phone
   - Passport/document details where required
7. Verify checkout amount before payment:
   - Verified Duffel fare
   - FlexeTravels service fee
   - Applicable service-fee tax
   - Total charged by Stripe
8. Confirm Duffel balance is at least verified fare plus configured buffer.
9. Pay through Stripe only after the above checks pass.
10. Wait for supplier booking completion and do not refresh during the final booking step unless the UI instructs you.

## Post-Payment Verification

Immediately verify:

- Stripe PaymentIntent succeeded for the exact checkout total.
- Duffel order/ticket was created.
- Duffel balance was deducted by the supplier fare amount.
- PNR/order reference exists.
- Customer confirmation email arrived at the passenger email entered in checkout.
- Supabase contains:
  - `user_sessions`
  - `search_logs`
  - `payment_quotes`
  - `payment_transactions`
  - `supplier_bookings`
  - `ledger_entries`
  - passenger/booking rows used by the current flow
- `/admin/support` can find the session/payment/PNR and reconstruct the timeline.

## Failure Handling

If Stripe payment succeeds but supplier booking fails:

1. Do not attempt a second manual booking until support dashboard and Stripe/Duffel states are checked.
2. Verify whether `/api/book-trip` initiated or completed a refund.
3. Record:
   - session id
   - quote id
   - PaymentIntent id
   - supplier offer id
   - failure stage
   - customer-safe error shown
4. Contact the customer using the entered email with a clear status update.

If Duffel balance is too low:

- Customer should see: `We cannot complete online ticketing for this fare right now. Your card has not been charged. Please contact support or try again shortly.`
- Internal logs/support records should retain the real reason, such as `DUFFEL_BALANCE_LOW`, without exposing it in the browser.

## Rehearsal Result Log

Fill this after the live rehearsal:

- Rehearsal date/time:
- Commit verified live:
- Route/date/cabin:
- Selected airline/fare brand:
- Verified fare:
- FlexeTravels fee:
- Tax on fee:
- Total charged:
- Stripe PaymentIntent:
- Duffel order id:
- PNR/booking reference:
- Confirmation email delivered to:
- Supabase timeline verified: yes/no
- Support lookup verified: yes/no
- Issues found:
- Recovery actions:
- Decision: ready for customer traffic / needs another rehearsal
