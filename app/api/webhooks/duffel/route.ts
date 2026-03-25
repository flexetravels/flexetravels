// ─── Duffel Webhook Handler ────────────────────────────────────────────────────
// Receives real-time disruption events from Duffel and routes them to the
// disruption agent via the orchestrator.
//
// Setup in Duffel dashboard:
//   Webhooks → Create endpoint → URL: https://<your-domain>/api/webhooks/duffel
//   Events to subscribe: order.flight_disrupted, order.cancelled, order.updated
//
// Security: Duffel signs requests with HMAC-SHA256 over the raw body.
// Set DUFFEL_WEBHOOK_SECRET in env to verify signatures.
// Without it, the endpoint still processes but logs a warning.

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { handleDisruption } from '@/lib/orchestrator';
import { db } from '@/lib/db/client';
import type { DisruptionType } from '@/lib/orchestrator/types';

// ─── Event type mapping ───────────────────────────────────────────────────────

const DUFFEL_TYPE_MAP: Record<string, DisruptionType> = {
  'order.flight_disrupted':        'flight_cancelled',
  'order.flight_delayed':          'flight_delayed',
  'order.schedule_changed':        'schedule_changed',
  'order.cancelled':               'flight_cancelled',
  'order.updated':                 'schedule_changed',
};

function mapDuffelType(rawType: string): DisruptionType {
  // Try exact match
  if (DUFFEL_TYPE_MAP[rawType]) return DUFFEL_TYPE_MAP[rawType];

  // Pattern matching
  if (rawType.includes('delay'))    return 'flight_delayed';
  if (rawType.includes('cancel'))   return 'flight_cancelled';
  if (rawType.includes('schedule')) return 'schedule_changed';

  return 'unknown';
}

// ─── HMAC signature verification ─────────────────────────────────────────────

function verifyDuffelSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.DUFFEL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook/duffel] DUFFEL_WEBHOOK_SECRET not set — skipping signature verification');
    return true; // Open in dev; lock down in production
  }
  if (!signatureHeader) {
    console.warn('[webhook/duffel] Missing Duffel-Signature header');
    return false;
  }

  // Duffel signature: "t=<timestamp>,v1=<hmac>"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), v.trim()];
    }),
  );

  const timestamp = parts['t'];
  const v1        = parts['v1'];
  if (!timestamp || !v1) return false;

  // Signed payload: "<timestamp>.<rawBody>"
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  // Timing-safe compare
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(v1, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Webhook handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Read raw body for HMAC verification BEFORE parsing JSON
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Could not read request body' }, { status: 400 });
  }

  // Verify signature
  const sigHeader = req.headers.get('Duffel-Signature');
  if (!verifyDuffelSignature(rawBody, sigHeader)) {
    console.error('[webhook/duffel] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Extract event fields
  const eventId   = payload['id']   as string | undefined;
  const eventType = payload['type'] as string | undefined;
  const data      = payload['data'] as Record<string, unknown> | undefined;

  if (!eventType || !data) {
    console.warn('[webhook/duffel] Missing type or data in payload');
    return NextResponse.json({ received: true, note: 'No type/data — ignoring' });
  }

  // Extract booking/order reference from the event data
  const orderId   = (data['id'] ?? data['order_id']) as string | undefined;
  const orderSlug = (data['booking_reference'] ?? '') as string;

  console.log('[webhook/duffel] received:', eventType, 'orderId:', orderId ?? '(none)');

  // Look up our internal booking by Duffel order ID / provider_ref
  let bookingId: string | undefined;
  if (orderId) {
    const booking = await db.bookings.getByRef(orderId).catch(() => null);
    bookingId = booking?.id;
    if (!booking) {
      console.warn('[webhook/duffel] No booking found for order:', orderId,
        '— storing event for later lookup');
    }
  }

  // Store the raw event regardless (for audit/replay)
  await db.events.insert({
    booking_id: bookingId ?? null,
    source:     'duffel_webhook',
    type:       eventType,
    payload: {
      event_id:  eventId,
      order_id:  orderId,
      order_ref: orderSlug,
      data,
    },
    processed: false,
  }).catch(e => console.error('[webhook/duffel] Event storage failed:', e));

  // Route to disruption agent if we have a matching booking
  if (bookingId) {
    const disruptionType = mapDuffelType(eventType);
    const result = await handleDisruption({
      eventId:   eventId ?? `duffel_${Date.now()}`,
      bookingId,
      type:      disruptionType,
      payload:   data,
    });

    if (!result.ok) {
      console.error('[webhook/duffel] Disruption handling failed:', result.error);
      // Still return 200 — Duffel retries on non-2xx
    } else {
      console.log('[webhook/duffel] Disruption handled:',
        result.data?.actions.map(a => a.type).join(', '));
    }
  }

  // Always acknowledge — Duffel expects 2xx within 5 seconds
  return NextResponse.json({ received: true, eventId, bookingId: bookingId ?? null });
}

// HEAD / GET for webhook verification ping
export async function GET() {
  return NextResponse.json({ status: 'webhook active', provider: 'duffel' });
}
