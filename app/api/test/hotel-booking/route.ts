// ─── /api/test/hotel-booking ───────────────────────────────────────────────────
// Dev/sandbox end-to-end test for LiteAPI hotel booking.
// Runs: search → prebook → book using hardcoded test passenger + sandbox card.
// Card hardcoded inside liteApiBook (4242424242424242, ACC_CREDIT_CARD, 12/2028).
//
// Usage (dev server must be running):
//   GET http://localhost:3000/api/test/hotel-booking
//
// NEVER expose this route in production — it creates real sandbox bookings.

import { NextResponse } from 'next/server';
import { LiteApiProvider, liteApiPrebook, liteApiBook } from '@/lib/search/liteapi';

// ─── Hardcoded test data ───────────────────────────────────────────────────────

const CHECK_IN  = '2026-05-15';
const CHECK_OUT = '2026-05-17';
const DEST      = 'Cancun';   // well-covered by LiteAPI sandbox

const TEST_PASSENGER = {
  firstName:   'John',
  lastName:    'Doe',
  email:       'test@flexetravels.com',
  phone:       '+14165551234',
  dateOfBirth: '1990-01-15',
};

// ─── Full LiteAPI flow: search → prebook → book ────────────────────────────────

async function testLiteApi() {
  const apiKey = process.env.LITEAPI_KEY;
  if (!apiKey || apiKey.includes('PASTE') || apiKey.includes('your_')) {
    return { skipped: true, reason: 'LITEAPI_KEY not configured in .env' };
  }

  const isSandbox = apiKey.startsWith('sand_');
  const steps: Record<string, unknown> = { isSandbox };
  const t0 = Date.now();

  // ── Step 1: Search for hotels ───────────────────────────────────────────────
  let rawOfferId: string | undefined;
  let hotelName:  string | undefined;

  try {
    const provider = new LiteApiProvider(apiKey);
    const hotels   = await provider.searchHotels({
      destination: DEST,
      checkIn:     CHECK_IN,
      checkOut:    CHECK_OUT,
      adults:      1,
    });

    const bookable = hotels.filter(h => !h.isSample && h.bookingToken?.startsWith('liteapi_'));

    steps.search = {
      status:      'ok',
      hotelsFound: hotels.length,
      bookable:    bookable.length,
      firstHotel:  bookable[0]?.name ?? hotels[0]?.name ?? 'none',
      sampleOnly:  hotels.every(h => h.isSample),
      latencyMs:   Date.now() - t0,
    };

    if (bookable.length === 0) {
      return {
        success: false,
        steps,
        error:   hotels.length > 0
          ? 'Hotels found but none had a bookable token — may be a LiteAPI rate issue'
          : 'No hotels returned at all — check LITEAPI_KEY and destination',
      };
    }

    // Strip the liteapi_ prefix to get the raw offerId for the prebook call
    rawOfferId = bookable[0].bookingToken!.replace('liteapi_', '');
    hotelName  = bookable[0].name;
  } catch (err) {
    steps.search = { status: 'error', error: String(err) };
    return { success: false, steps, error: String(err) };
  }

  // ── Step 2: Prebook (confirm price, get prebookId) ──────────────────────────
  const t1 = Date.now();
  let prebookId: string;

  try {
    const prebook = await liteApiPrebook(rawOfferId!, 'US', apiKey);

    steps.prebook = {
      status:         prebook.success ? 'ok' : 'error',
      prebookId:      prebook.prebookId,
      confirmedTotal: prebook.confirmedTotal,
      currency:       prebook.currency,
      cancellation:   prebook.cancellationType,
      error:          prebook.error,
      latencyMs:      Date.now() - t1,
    };

    if (!prebook.success || !prebook.prebookId) {
      return { success: false, steps, error: prebook.error ?? 'No prebookId in prebook response' };
    }
    prebookId = prebook.prebookId;
  } catch (err) {
    steps.prebook = { status: 'error', error: String(err) };
    return { success: false, steps, error: String(err) };
  }

  // ── Step 3: Book (sandbox card hardcoded inside liteApiBook) ────────────────
  // Card used: 4242424242424242 / ACC_CREDIT_CARD / 12/2028 / CVV 123
  const t2 = Date.now();

  try {
    const book = await liteApiBook({
      prebookId,
      guestFirstName: TEST_PASSENGER.firstName,
      guestLastName:  TEST_PASSENGER.lastName,
      guestEmail:     TEST_PASSENGER.email,
      apiKey,
    });

    steps.book = {
      status:      book.success ? 'ok' : 'error',
      bookingId:   book.bookingId,
      bookStatus:  book.status,
      totalAmount: book.totalAmount,
      currency:    book.currency,
      hotelName:   book.hotelName ?? hotelName,
      checkIn:     book.checkIn,
      checkOut:    book.checkOut,
      cardUsed:    '4242424242424242 (sandbox)',
      error:       book.error,
      latencyMs:   Date.now() - t2,
    };

    return {
      success:     book.success,
      bookingId:   book.bookingId,
      hotelName:   book.hotelName ?? hotelName,
      totalMs:     Date.now() - t0,
      steps,
      error:       book.success ? undefined : book.error,
    };
  } catch (err) {
    steps.book = { status: 'error', error: String(err) };
    return { success: false, steps, error: String(err) };
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Test endpoint disabled in production' }, { status: 403 });
  }

  const started = new Date().toISOString();
  const result  = await testLiteApi();

  return NextResponse.json({
    started,
    testPassenger: TEST_PASSENGER,
    checkIn:       CHECK_IN,
    checkOut:      CHECK_OUT,
    destination:   DEST,
    cardUsed:      '4242424242424242 / ACC_CREDIT_CARD / 12/2028',
    overallStatus: 'skipped' in result
      ? '⏭ SKIPPED'
      : result.success
        ? '✅ PASSED'
        : '❌ FAILED',
    result,
  }, {
    status: ('skipped' in result || result.success) ? 200 : 502,
  });
}
