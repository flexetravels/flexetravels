// ─── Stripe PaymentIntent Route ────────────────────────────────────────────────
// Creates a $20 USD PaymentIntent for the FlexeTravels service fee.
// Returns the clientSecret used by the embedded Stripe.js form on the client.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPaymentIntent } from '@/lib/stripe';

const schema = z.object({
  bookingReference: z.string().min(1).max(64),
  bookingType:      z.enum(['flight', 'hotel']),
  customerEmail:    z.string().email().optional(),
});

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.trim() === '') {
    return NextResponse.json(
      { error: 'Payment not configured.' },
      { status: 503 }
    );
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await createPaymentIntent(parsed.data);
    return NextResponse.json({
      clientSecret:    result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount:          result.amount,
      currency:        result.currency,
    });
  } catch (err) {
    console.error('[/api/stripe/create-payment-intent] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
