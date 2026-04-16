// lib/confirmed-payments.ts
// DB-backed payment confirmation.
// The payments table (written by /api/webhooks/stripe) is the source of truth.

import { db } from '@/lib/db/client';

/**
 * Returns true if the Stripe PaymentIntent has been recorded as succeeded in DB.
 * Used to guard booking routes against replays and double-submissions.
 */
export async function isPaymentConfirmed(intentId: string): Promise<boolean> {
  const data = await db.payments.getByIntentId(intentId);
  return !!data && data.status === 'succeeded';
}
