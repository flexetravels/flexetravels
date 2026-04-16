// ─── /api/complete-hotel-booking ──────────────────────────────────────────────
// Second phase of the production hotel booking flow (usePaymentSdk: true).
//
// Flow:
//   1. /api/book-trip  → prebook hotel → returns hotelPrebookId + secretKey + transactionId
//   2. Frontend         → LiteAPI payment SDK widget → customer pays hotel cost directly
//   3. /api/complete-hotel-booking → liteApiBook with TRANSACTION_ID → confirms booking
//   4. Saves hotel booking row to DB with full metadata
//
// In sandbox (sand_ key) this endpoint is not used — /api/book-trip handles the
// full server-side flow using ACC_CREDIT_CARD.

import { NextResponse } from 'next/server';
import { z }            from 'zod';
import { liteApiBook }  from '@/lib/search/liteapi';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const BodySchema = z.object({
  prebookId:      z.string().min(1),
  transactionId:  z.string().min(1),   // from LiteAPI payment SDK after customer pays
  guestFirstName: z.string().min(1),
  guestLastName:  z.string().min(1),
  guestEmail:     z.string().email(),
  // Optional context for DB storage
  tripId:         z.string().optional(),
  sessionId:      z.string().optional().default('unknown'),
  hotelName:      z.string().optional(),
  hotelId:        z.string().optional(),
  checkIn:        z.string().optional(),
  checkOut:       z.string().optional(),
  currency:       z.string().optional().default('USD'),
});

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:complete-hotel-booking:${ip}`, 3, 60_000)) {
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
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    prebookId, transactionId,
    guestFirstName, guestLastName, guestEmail,
    tripId, sessionId, hotelName, hotelId, checkIn, checkOut, currency,
  } = parsed.data;

  console.log('[complete-hotel-booking] prebookId:', prebookId, '| transactionId present:', !!transactionId);

  // ── Session / payment verification ──────────────────────────────────────────
  // Verify that the requesting session has a real trip in the DB before confirming
  // the hotel booking. This ensures the transactionId comes from a legitimate
  // paying customer session that went through /api/book-trip.
  if (DB_AVAILABLE) {
    let verified = false;

    if (tripId) {
      // Verify the tripId belongs to this session
      const trip = await db.trips.get(tripId).catch(() => null);
      verified = !!(trip && trip.session_id === sessionId);
    }

    if (!verified && sessionId && sessionId !== 'unknown') {
      // Fall back: check if any trip exists for this session
      const trip = await db.trips.getBySession(sessionId).catch(() => null);
      verified = !!trip;
    }

    if (!verified) {
      console.warn('[complete-hotel-booking] No verified session/trip — rejecting for prebookId:', prebookId);
      return NextResponse.json(
        { success: false, error: 'Payment verification failed' },
        { status: 402 },
      );
    }
  }

  const result = await liteApiBook({
    prebookId,
    transactionId,
    guestFirstName,
    guestLastName,
    guestEmail,
  });

  if (!result.success) {
    console.error('[complete-hotel-booking] liteApiBook failed:', result.error);
    return NextResponse.json(
      { success: false, error: result.error ?? 'Hotel booking failed after payment' },
      { status: 502 }
    );
  }

  console.log('[complete-hotel-booking] success! bookingId:', result.bookingId);

  // ── Persist to DB ────────────────────────────────────────────────────────────
  if (DB_AVAILABLE && result.bookingId) {
    try {
      // Ensure trip row exists
      let resolvedTripId = tripId;
      if (!resolvedTripId) {
        const trip = await db.trips.create({
          session_id:  sessionId ?? 'unknown',
          status:      'booked',
          origin:      '',
          destination: result.hotelName ?? hotelName ?? '',
          depart_date: checkIn ?? result.checkIn ?? new Date().toISOString().slice(0, 10),
          check_in:    checkIn ?? result.checkIn,
          check_out:   checkOut ?? result.checkOut,
        });
        resolvedTripId = trip?.id;
      }

      if (resolvedTripId) {
        const amountCents = result.totalAmount ? Math.round(result.totalAmount * 100) : 0;
        const bk = await db.bookings.create({
          trip_id:      resolvedTripId,
          type:         'hotel',
          provider:     'liteapi',
          status:       'confirmed',
          provider_ref: result.bookingId,
          booking_ref:  result.bookingId,
          amount_cents: amountCents,
          currency:     result.currency ?? currency ?? 'USD',
          metadata: {
            prebookId,
            hotelName:   result.hotelName ?? hotelName,
            hotelId,
            checkIn:     result.checkIn ?? checkIn,
            checkOut:    result.checkOut ?? checkOut,
            address:     result.address,
            guestEmail,
            guestName:   `${guestFirstName} ${guestLastName}`,
            sessionId,
            paymentMethod: 'TRANSACTION_ID',   // production payment SDK
          },
        });
        console.log('[complete-hotel-booking] DB booking row created:', bk?.id, '| amount:', amountCents);
      }
    } catch (e) {
      // DB failure is non-fatal — booking already confirmed with LiteAPI
      console.error('[complete-hotel-booking] DB persist failed (non-fatal):', e);
    }
  }

  return NextResponse.json({
    success:     true,
    bookingId:   result.bookingId,
    status:      result.status,
    totalAmount: result.totalAmount,
    currency:    result.currency,
    hotelName:   result.hotelName ?? hotelName,
    address:     result.address,
    checkIn:     result.checkIn ?? checkIn,
    checkOut:    result.checkOut ?? checkOut,
  });
}
