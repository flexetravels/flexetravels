// ─── Stripe Checkout Route ────────────────────────────────────────────────────
// Creates a $20 service fee checkout session.
// Stripe keys are NOT configured until Phase 6 — route returns 503 until then.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceFeeCheckout } from '@/lib/stripe';

const schema = z.object({
  bookingReference: z.string().min(1),
  flightDescription: z.string().min(1),
  customerEmail: z.string().email().optional(),
  sessionId: z.string().optional(),
});

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.trim() === '') {
    return NextResponse.json(
      { error: 'Payment not yet configured. Stripe keys are pending setup.' },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const { bookingReference, flightDescription, customerEmail } = parsed.data;

    const { url, sessionId } = await createServiceFeeCheckout({
      bookingReference,
      flightDescription,
      customerEmail,
      successUrl: `${appUrl}/booking?ref=${bookingReference}&fee_paid=true&stripe_session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${appUrl}/chat`,
    });

    return NextResponse.json({ url, sessionId });
  } catch (err) {
    console.error('[/api/stripe/checkout] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
