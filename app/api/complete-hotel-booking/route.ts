// ─── /api/complete-hotel-booking ──────────────────────────────────────────────
// Second phase of the production hotel booking flow (usePaymentSdk: true).
//
// Flow:
//   1. /api/book-trip  → prebook hotel → returns hotelPrebookId + hotelSecretKey + hotelTransactionId
//   2. Frontend         → LiteAPI payment SDK widget → customer pays hotel cost
//   3. /api/complete-hotel-booking → liteApiBook with method: TRANSACTION_ID → confirms booking
//
// In sandbox (sand_ key), this endpoint is not used: /api/book-trip handles
// the full flow server-side using ACC_CREDIT_CARD.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { liteApiBook } from '@/lib/search/liteapi';

const BodySchema = z.object({
  prebookId:      z.string().min(1),
  transactionId:  z.string().min(1),   // from LiteAPI payment SDK after customer pays
  guestFirstName: z.string().min(1),
  guestLastName:  z.string().min(1),
  guestEmail:     z.string().email(),
});

export async function POST(req: Request) {
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

  const { prebookId, transactionId, guestFirstName, guestLastName, guestEmail } = parsed.data;

  console.log('[complete-hotel-booking] prebookId:', prebookId, '| transactionId present:', !!transactionId);

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

  return NextResponse.json({
    success:     true,
    bookingId:   result.bookingId,
    status:      result.status,
    totalAmount: result.totalAmount,
    currency:    result.currency,
    hotelName:   result.hotelName,
    address:     result.address,
    checkIn:     result.checkIn,
    checkOut:    result.checkOut,
  });
}
