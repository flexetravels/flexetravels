// ─── /api/cancel-flight — 24-Hour Flight Cancellation (US DOT 14 CFR 259.5) ────
// Endpoint: POST /api/cancel-flight
// Validates request → calls Duffel cancellation API → logs to DB → returns result.
//
// US DOT 14 CFR 259.5 Compliance:
// - Allows passengers to cancel flights within 24 hours of booking at no penalty
// - Refund issued to original payment method within 7 business days
// - This endpoint is payment-first: Stripe $20 fee is already charged before flight booking
//   So the user's only recourse is the airline's refund (which we pass through)

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

// ─── Request schema ───────────────────────────────────────────────────────────

const BodySchema = z.object({
  orderId:   z.string().min(1, 'orderId is required'),
  sessionId: z.string().min(1, 'sessionId is required'),
});

// ─── Duffel cancellation (extracted from @/lib/agents/cancellation.ts pattern) ───

interface DuffelCancellationQuote {
  id: string;
  refund_amount?: string;
  refund_currency?: string;
  refund_to?: string;
}

interface DuffelCancellationConfirm {
  refund_amount?: string;
  refund_currency?: string;
}

async function duffelCancel(
  orderId: string,
): Promise<{
  success: boolean;
  refundAmount?: string;
  currency?: string;
  voidable?: boolean;
  error?: string;
}> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) {
    return { success: false, error: 'DUFFEL_ACCESS_TOKEN not configured' };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // ── Step 1: Create cancellation quote (check if order can be cancelled) ─────
  let createRes: Response;
  try {
    createRes = await fetch(
      'https://api.duffel.com/air/order_cancellations',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { order_id: orderId } }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return {
      success: false,
      error: `Network error creating cancellation quote: ${String(e)}`,
    };
  }

  if (!createRes.ok) {
    const txt = await createRes.text();
    let msg = txt.slice(0, 300);
    let body: Record<string, unknown> = {};

    try {
      body = JSON.parse(txt);
      const errors = (body.errors ?? []) as Array<{ message?: string }>;
      if (errors.length > 0) {
        msg = errors[0].message ?? msg;
      }
    } catch {
      // Could not parse JSON, use raw text
    }

    console.error(
      '[cancel-flight] Duffel cancel create failed',
      createRes.status,
      msg,
    );

    // Check if this is a "void window expired" error (24-hour window passed)
    const isExpired =
      msg.toLowerCase().includes('void') ||
      msg.toLowerCase().includes('expired') ||
      msg.toLowerCase().includes('outside the window') ||
      msg.toLowerCase().includes('non-refundable');

    if (isExpired) {
      return {
        success: false,
        voidable: false,
        error:
          'The 24-hour cancellation window has passed. ' +
          'Please contact the airline directly for cancellation options. ' +
          'Refund policy depends on your ticket type.',
      };
    }

    return {
      success: false,
      error: `Cancellation request failed (${createRes.status}): ${msg}`,
    };
  }

  let cancelData: { data?: DuffelCancellationQuote };
  try {
    cancelData = (await createRes.json()) as { data?: DuffelCancellationQuote };
  } catch {
    return { success: false, error: 'Failed to parse Duffel cancellation response' };
  }

  const cancellationId = cancelData.data?.id;
  if (!cancellationId) {
    return {
      success: false,
      error: 'No cancellation ID returned from Duffel',
    };
  }

  const refundAmount = cancelData.data?.refund_amount;
  const refundCurrency = cancelData.data?.refund_currency ?? 'USD';

  // Check if this is a refundable cancellation (has refund_amount)
  const isRefundable = !!refundAmount;

  // ── Step 2: Confirm cancellation (actually process it) ──────────────────────
  let confirmRes: Response;
  try {
    confirmRes = await fetch(
      `https://api.duffel.com/air/order_cancellations/${cancellationId}/actions/confirm`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return {
      success: false,
      error: `Network error confirming cancellation: ${String(e)}`,
    };
  }

  if (!confirmRes.ok) {
    const txt = await confirmRes.text();
    let msg = txt.slice(0, 300);

    try {
      const body = JSON.parse(txt) as Record<string, unknown>;
      const errors = (body.errors ?? []) as Array<{ message?: string }>;
      if (errors.length > 0) {
        msg = errors[0].message ?? msg;
      }
    } catch {
      // Could not parse JSON, use raw text
    }

    console.error(
      '[cancel-flight] Duffel cancel confirm failed',
      confirmRes.status,
      msg,
    );

    return {
      success: false,
      error: `Cancellation confirm failed (${confirmRes.status}): ${msg}`,
    };
  }

  let confirmed: { data?: DuffelCancellationConfirm };
  try {
    confirmed = (await confirmRes.json()) as { data?: DuffelCancellationConfirm };
  } catch {
    return {
      success: false,
      error: 'Failed to parse Duffel confirmation response',
    };
  }

  return {
    success: true,
    voidable: isRefundable,
    refundAmount: confirmed.data?.refund_amount ?? refundAmount,
    currency: confirmed.data?.refund_currency ?? refundCurrency,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:cancel-flight:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation error',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { orderId, sessionId } = parsed.data;

  console.log('[cancel-flight] Request received', { orderId, sessionId });

  // ── Call Duffel cancellation API ───────────────────────────────────────────
  const result = await duffelCancel(orderId);

  // ── Log cancellation event to DB if available ──────────────────────────────
  if (DB_AVAILABLE) {
    try {
      // Try to find the booking by provider_ref (orderId is the Duffel order ID)
      const booking = await db.bookings.getByRef(orderId);

      if (booking) {
        await db.events.insert({
          booking_id: booking.id,
          trip_id: booking.trip_id,
          source: 'user',
          type: 'order.cancellation_requested',
          payload: {
            orderId,
            sessionId,
            success: result.success,
            refundAmount: result.refundAmount,
            currency: result.currency,
            voidable: result.voidable,
            error: result.error,
          },
          processed: false,
        });

        // If cancellation was successful, update booking status
        if (result.success) {
          await db.bookings.update(booking.id, {
            status: 'cancelled',
          });
        }

        console.log('[cancel-flight] Event logged to DB', booking.id);
      } else {
        console.warn('[cancel-flight] No booking found for order', orderId);
      }
    } catch (e) {
      console.error('[cancel-flight] Failed to log event to DB:', e);
      // Don't fail the response — DB logging is best-effort
    }
  }

  // ── Return result to client ────────────────────────────────────────────────
  if (result.success) {
    console.log('[cancel-flight] Cancellation succeeded', {
      orderId,
      refundAmount: result.refundAmount,
      currency: result.currency,
    });

    return NextResponse.json(
      {
        success: true,
        refundAmount: result.refundAmount,
        refundCurrency: result.currency,
        voidable: result.voidable,
        message:
          'Flight cancellation successful. Refund will be processed to your original payment method within 7 business days.',
      },
      { status: 200 },
    );
  }

  // ── Cancellation failed (could be expired 24-hour window or other error) ────
  console.warn('[cancel-flight] Cancellation failed', {
    orderId,
    error: result.error,
  });

  // Return 402 (Payment Required) for expired void window to signal policy issue
  const statusCode = result.voidable === false ? 402 : 400;

  return NextResponse.json(
    {
      success: false,
      voidable: result.voidable,
      error: result.error,
    },
    { status: statusCode },
  );
}
