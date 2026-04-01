// ─── /api/stripe/prepare ─────────────────────────────────────────────────────
// Creates a Stripe PaymentIntent for the $20 FlexeTravels service fee.
// Called BEFORE any flight/hotel booking — this is Step 1 of the payment-first flow.
//
// Flow:
//   1. Client calls this route with basic booking metadata
//   2. We create a $20 USD PaymentIntent in Stripe (no bookings happen)
//   3. Client mounts Stripe Elements using the returned clientSecret
//   4. User pays $20
//   5. Client calls /api/book-trip with paymentIntentId as proof of payment
//   6. /api/book-trip verifies the PI is 'succeeded' before touching Duffel/LiteAPI

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPaymentIntent } from '@/lib/stripe';

const schema = z.object({
  bookingReference: z.string().min(1),
  customerEmail:    z.string().email().optional(),
});

export async function POST(req: Request) {
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

  try {
    const { bookingReference, customerEmail } = parsed.data;

    const result = await createPaymentIntent({
      bookingReference,
      bookingType:   'flight',   // used for Stripe metadata label
      customerEmail,
      amount:        2000,       // $20.00 USD in cents
      currency:      'usd',
    });

    return NextResponse.json({
      clientSecret:    result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount:          result.amount,
      currency:        result.currency,
    });
  } catch (err) {
    console.error('[/api/stripe/prepare]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
