// ─── Stripe Webhook Route ─────────────────────────────────────────────────────
// Listens for checkout.session.completed events to confirm $20 fee payment.
// In staging: webhook handled via Stripe CLI or Dashboard test events.

import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/stripe';

// In-memory confirmed payments store (replace with DB in production)
const confirmedPayments = new Map<string, { paidAt: string; bookingRef: string }>();

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const signature = req.headers.get('stripe-signature') ?? '';
  const payload   = await req.text();

  // Verify signature
  const isValid = await verifyWebhookSignature(payload, signature, webhookSecret);
  if (!isValid) {
    console.warn('[stripe webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: { id: string; payment_status: string; metadata?: Record<string, string> } };
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingRef = session.metadata?.booking_reference;

    if (bookingRef) {
      confirmedPayments.set(session.id, {
        paidAt:     new Date().toISOString(),
        bookingRef,
      });
      console.log(`[stripe webhook] Fee confirmed for booking ${bookingRef}`);
    }
  }

  return NextResponse.json({ received: true });
}

// Export for use by booking API to check payment status
export { confirmedPayments };
