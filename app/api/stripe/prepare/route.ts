// ─── /api/stripe/prepare ─────────────────────────────────────────────────────
// Creates a Stripe PaymentIntent for:
//   • Flight fare     — the actual ticket price shown to the user
//   • Service fee     — FlexeTravels flat $20 booking fee
//
// Both are collected in a SINGLE Stripe charge so the customer enters their
// card details exactly once before any booking APIs are called.
//
// Hotel cost is NOT collected here — LiteAPI's own payment widget handles that
// in a separate step after the flight is confirmed (production only).
//
// Flow:
//   1. Client calls this route with flight price + metadata
//   2. We create a PaymentIntent for (flightPriceCents + 2000) in Stripe
//   3. Client mounts Stripe Elements using the returned clientSecret
//   4. User enters card and pays
//   5. Client calls /api/book-trip with paymentIntentId as proof of payment
//   6. /api/book-trip verifies PI status === 'succeeded' before touching Duffel/LiteAPI

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPaymentIntent } from '@/lib/stripe';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const SERVICE_FEE_CENTS = 2000; // $20.00

const schema = z.object({
  bookingReference:  z.string().min(1),
  customerEmail:     z.string().email().optional(),
  // Flight fare — required so Stripe collects the correct total
  flightPriceCents:  z.number().int().min(0).max(600_000).default(0),   // max $6 000 per pax
  flightCurrency:    z.string().min(3).max(3).default('USD'),
  flightDescription: z.string().optional(),   // e.g. "YYZ → CUN (Air Canada)"
  hotelTotalCents:   z.number().int().min(0).optional(),  // informational only — not charged here
  passengerCount:    z.number().int().min(1).optional(),  // total passengers for metadata
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:stripe/prepare:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey?.trim()) {
    return NextResponse.json(
      { error: 'Payment not yet configured.' },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { bookingReference, customerEmail, flightPriceCents, flightCurrency, flightDescription, hotelTotalCents, passengerCount } = parsed.data;
  const currency    = flightCurrency.toLowerCase();
  const totalAmount = flightPriceCents + SERVICE_FEE_CENTS; // flight + $20 service fee

  if (totalAmount <= 0) {
    return NextResponse.json({ error: 'Invalid total amount' }, { status: 400 });
  }

  // MEDIUM severity: Build an improved human-readable description for the Stripe dashboard and receipt
  const flightLabel  = flightDescription ?? 'Flight';
  const flightFormatted  = `$${(flightPriceCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const feeFormatted     = `$${(SERVICE_FEE_CENTS  / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const totalFormatted   = `$${(totalAmount         / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const passengerSuffix = passengerCount ? ` | Passengers: ${passengerCount}` : '';
  const hotelSuffix = hotelTotalCents && hotelTotalCents > 0
    ? ` | Hotel: $${(hotelTotalCents / 100).toFixed(2)} ${currency.toUpperCase()} (separate)`
    : '';
  const description = `FlexeTravels booking: ${flightLabel} ${flightFormatted} + service fee ${feeFormatted} = ${totalFormatted}${passengerSuffix}${hotelSuffix}`;

  try {
    const result = await createPaymentIntent({
      bookingReference,
      bookingType:   'flight',
      customerEmail,
      amount:        totalAmount,
      currency,
      description,
      metadata: {
        flight_price_cents:    String(flightPriceCents),
        service_fee_cents:     String(SERVICE_FEE_CENTS),
        total_cents:           String(totalAmount),
        flight_description:    flightLabel,
        booking_reference:     bookingReference,
        passenger_count:       String(passengerCount ?? 1),
        hotel_total_cents:     String(hotelTotalCents ?? 0),
      },
    });

    return NextResponse.json({
      clientSecret:    result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount:          result.amount,
      currency:        result.currency,
      // Breakdown so the frontend can display what's being charged
      breakdown: {
        flightCents:     flightPriceCents,
        serviceFeeCents: SERVICE_FEE_CENTS,
        totalCents:      totalAmount,
        currency:        currency.toUpperCase(),
      },
    });
  } catch (err) {
    console.error('[stripe/prepare] Error:', err);
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 });
  }
}
