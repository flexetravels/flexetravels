// ─── Stripe Webhook Handler ────────────────────────────────────────────────────
// Verifies Stripe-Signature, then handles payment_intent events to update DB.
//
// Events handled:
//   payment_intent.succeeded       → mark booking payment confirmed in DB
//   payment_intent.payment_failed  → log for support triage
//
// IMPORTANT: this route reads the raw request body before any parsing — Next.js
// must not transform it. We disable body parsing via the route config below.

import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/stripe';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { confirmedPayments } from '@/lib/confirmed-payments';

export const dynamic = 'force-dynamic';

// Stripe sends the raw body; we must read it as text to verify the signature.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook/stripe] STRIPE_WEBHOOK_SECRET not set — rejecting all events');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // Read raw body as text (needed for HMAC verification)
  const payload   = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  const valid = await verifyWebhookSignature(payload, signature, secret);
  if (!valid) {
    console.warn('[webhook/stripe] invalid signature — possible replay or misconfigured secret');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const intent = event.data.object as {
    id:       string;
    status:   string;
    amount:   number;
    currency: string;
    metadata?: Record<string, string>;
    last_payment_error?: { message?: string };
  };

  const bookingRef = intent.metadata?.booking_reference ?? '';

  // ── checkout.session.completed ───────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { id: string; payment_status: string; metadata?: Record<string, string>; amount_total?: number; currency?: string };
    const bookingRef = session.metadata?.booking_reference ?? '';
    console.log('[webhook/stripe] checkout.session.completed | session:', session.id, '| ref:', bookingRef);

    if (bookingRef) {
      confirmedPayments.set(session.id, { paidAt: new Date().toISOString(), bookingRef });

      // Persist to payments table
      if (DB_AVAILABLE) {
        try {
          await db.payments.create({
            stripe_session_id: session.id,
            booking_ref:       bookingRef,
            amount_cents:      session.amount_total ?? 2000,
            currency:          session.currency ?? 'USD',
            status:            'succeeded',
            paid_at:           new Date().toISOString(),
          });
        } catch (e) {
          console.error('[webhook/stripe] payments insert failed (non-fatal):', e);
        }
      }
    }

    return NextResponse.json({ received: true });
  }

  // ── payment_intent.succeeded ─────────────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    console.log('[webhook/stripe] payment_intent.succeeded | intent:', intent.id, '| ref:', bookingRef, '| amount:', intent.amount, intent.currency);

    // Mark in-memory so the frontend can poll for confirmation (legacy path)
    if (bookingRef) {
      confirmedPayments.set(intent.id, { paidAt: new Date().toISOString(), bookingRef });
    }

    // Update booking row in DB — find by booking_ref (the PNR / LiteAPI bookingId)
    if (DB_AVAILABLE && bookingRef) {
      try {
        const booking = await db.bookings.getByRef(bookingRef);
        if (booking) {
          // Idempotency: skip if this intent was already recorded
          const existingIntentId = (booking.metadata as Record<string, unknown> | null)?.stripe_payment_intent_id;
          if (existingIntentId === intent.id) {
            console.log('[webhook/stripe] duplicate event — already processed intent:', intent.id);
            return NextResponse.json({ received: true });
          }

          // Mark booking confirmed + record payment details
          await db.bookings.update(booking.id, {
            status: 'confirmed',
            metadata: {
              ...(booking.metadata ?? {}),
              stripe_payment_intent_id: intent.id,
              stripe_paid_at:           new Date().toISOString(),
              stripe_amount_cents:      intent.amount,
              stripe_currency:          intent.currency,
            },
          });

          // Persist to payments table
          try {
            const existingPayment = await db.payments.getByIntentId(intent.id);
            if (!existingPayment) {
              await db.payments.create({
                stripe_intent_id: intent.id,
                booking_ref:      bookingRef,
                amount_cents:     intent.amount,
                currency:         intent.currency ?? 'USD',
                status:           'succeeded',
                paid_at:          new Date().toISOString(),
              });
            }
          } catch (e) {
            console.error('[webhook/stripe] payments insert failed (non-fatal):', e);
          }

          console.log('[webhook/stripe] booking confirmed + metadata updated:', booking.id, '| ref:', bookingRef);
        } else {
          // Booking may not exist yet if /api/book-trip failed after Stripe charge
          // (rare, but log for support triage)
          console.warn('[webhook/stripe] no booking found for ref:', bookingRef, '— payment confirmed but booking row missing');
        }
      } catch (e) {
        // DB failure is non-fatal — payment succeeded, log for manual reconciliation
        console.error('[webhook/stripe] DB update failed (non-fatal):', e);
      }
    }

    return NextResponse.json({ received: true });
  }

  // ── payment_intent.payment_failed ────────────────────────────────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const reason = intent.last_payment_error?.message ?? 'unknown';
    console.warn('[webhook/stripe] payment_intent.payment_failed | intent:', intent.id, '| ref:', bookingRef, '| reason:', reason);

    // Update booking row to reflect payment failure so support team can see it
    if (DB_AVAILABLE && bookingRef) {
      try {
        const booking = await db.bookings.getByRef(bookingRef);
        if (booking) {
          await db.bookings.update(booking.id, {
            metadata: {
              ...(booking.metadata ?? {}),
              stripe_payment_intent_id: intent.id,
              stripe_failed_at:         new Date().toISOString(),
              stripe_failure_reason:    reason,
            },
          });
        }
      } catch (e) {
        console.error('[webhook/stripe] DB update failed on payment failure (non-fatal):', e);
      }
    }

    return NextResponse.json({ received: true });
  }

  // All other event types — acknowledge without action
  console.log('[webhook/stripe] unhandled event type:', event.type);
  return NextResponse.json({ received: true });
}
