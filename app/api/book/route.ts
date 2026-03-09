// ─── Booking API Route ────────────────────────────────────────────────────────
// Handles flight bookings via Duffel.
// Note: No IATA/CPBC licence — bookings processed through Duffel (IATA-accredited).
// The $20 FlexeTravels service fee is NOT collected here — handled by Stripe separately.

import { z } from 'zod';
import { NextResponse } from 'next/server';

// ─── Validation schema ─────────────────────────────────────────────────────────
const bookingSchema = z.object({
  offerId: z.string().min(1, 'Offer ID required'),
  sessionId: z.string().optional(),
  passengers: z.array(z.object({
    firstName:   z.string().min(1),
    lastName:    z.string().min(1),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    email:       z.string().email(),
    phone:       z.string().min(7),
    gender:      z.enum(['m', 'f']).optional().default('m'),
    title:       z.enum(['mr','ms','mrs','miss','dr']).optional().default('mr'),
  })).min(1).max(9),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = bookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { offerId, passengers } = parsed.data;
    const token = process.env.DUFFEL_ACCESS_TOKEN;

    if (!token) {
      return NextResponse.json({ error: 'Booking service not configured' }, { status: 503 });
    }

    // ── First: verify the offer is still valid ─────────────────────────────
    const verifyRes = await fetch(`https://api.duffel.com/air/offers/${offerId}`, {
      headers: {
        Authorization:    `Bearer ${token}`,
        'Duffel-Version': 'v2',
        Accept:           'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!verifyRes.ok) {
      if (verifyRes.status === 404) {
        return NextResponse.json(
          { error: 'This flight offer has expired. Please search again for current prices.' },
          { status: 410 }
        );
      }
      const errText = await verifyRes.text();
      return NextResponse.json(
        { error: `Offer verification failed: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const offerData = await verifyRes.json() as {
      data?: { total_amount: string; total_currency: string; expires_at?: string }
    };

    // Check offer hasn't expired
    const expiresAt = offerData.data?.expires_at;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return NextResponse.json(
        { error: 'This offer has expired. Please search again.' },
        { status: 410 }
      );
    }

    // ── Create the order ───────────────────────────────────────────────────
    const orderRes = await fetch('https://api.duffel.com/air/orders', {
      method: 'POST',
      headers: {
        Authorization:    `Bearer ${token}`,
        'Duffel-Version': 'v2',
        'Content-Type':   'application/json',
        Accept:           'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'instant',
          selected_offers: [offerId],
          passengers: passengers.map(p => ({
            title:        p.title ?? 'mr',
            gender:       p.gender ?? 'm',
            given_name:   p.firstName,
            family_name:  p.lastName,
            born_on:      p.dateOfBirth,
            email:        p.email,
            phone_number: p.phone.startsWith('+') ? p.phone : `+1${p.phone.replace(/\D/g, '')}`,
            type: 'adult',
          })),
          payments: [{
            type:     'balance',
            amount:   offerData.data?.total_amount ?? '0',
            currency: offerData.data?.total_currency ?? 'USD',
          }],
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!orderRes.ok) {
      const errText = await orderRes.text();
      const errJson = (() => { try { return JSON.parse(errText); } catch { return null; } })();
      const message = errJson?.errors?.[0]?.message ?? errText.slice(0, 300);
      return NextResponse.json(
        { error: `Booking failed: ${message}` },
        { status: 502 }
      );
    }

    const order = await orderRes.json() as {
      data?: {
        id: string;
        booking_reference: string;
        total_amount: string;
        total_currency: string;
        documents?: Array<{ url?: string; type?: string }>;
        passengers?: Array<{ id: string; given_name: string; family_name: string }>;
      }
    };

    return NextResponse.json({
      success:          true,
      orderId:          order.data?.id,
      bookingReference: order.data?.booking_reference,
      totalAmount:      order.data?.total_amount,
      currency:         order.data?.total_currency ?? 'USD',
      documents:        order.data?.documents ?? [],
      // Remind frontend to collect $20 service fee via Stripe
      serviceFee: {
        amount:   20,
        currency: 'USD',
        message:  'A $20 FlexeTravels service fee will be charged separately via Stripe.',
      },
    });

  } catch (err) {
    console.error('[/api/book] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}
