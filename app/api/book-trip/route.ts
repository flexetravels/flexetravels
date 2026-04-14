// ─── /api/book-trip — Thin Controller ─────────────────────────────────────────
// All booking logic lives in /lib/agents/booking.ts (via orchestrator).
// This route only: validates input → calls orchestrator → returns JSON.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { book } from '@/lib/orchestrator';
import { getPaymentIntent } from '@/lib/stripe';
import { db } from '@/lib/db/client';

// ─── Request schema ────────────────────────────────────────────────────────────

const PassengerSchema = z.object({
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  email:       z.string().email(),
  phone:       z.string().min(6),
  title:       z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']).optional().default('mr'),
  gender:      z.enum(['m', 'f']).optional().default('m'),
  // Passport / travel document — required by Duffel for international flights
  passportNumber:         z.string().optional(),
  passportIssuingCountry: z.string().length(2).optional(),   // ISO 3166-1 alpha-2
  passportExpiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ChildPassengerSchema = z.object({
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  gender:      z.enum(['m', 'f']).optional().default('m'),
  // Passport / travel document
  passportNumber:         z.string().optional(),
  passportIssuingCountry: z.string().length(2).optional(),
  passportExpiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const BodySchema = z.object({
  sessionId:              z.string().optional(),
  paymentIntentId:        z.string().optional(),  // Stripe PI — required when Stripe is configured
  flightOfferId:          z.string().optional(),
  requestedPriceCents:    z.number().optional(),  // price shown to user — for stale-rate detection
  // Flight search params for server-side offer refresh on 422
  flightOrigin:           z.string().optional(),
  flightDestination:   z.string().optional(),
  flightDepartureDate: z.string().optional(),
  flightCabinClass:    z.string().optional(),
  flightPassengers:    z.number().optional(),
  hotelRateId:         z.string().optional(),
  hotelName:        z.string().optional(),
  hotelId:          z.string().optional(),   // LiteAPI property ID for fresh-rate fetch
  hotelCheckIn:     z.string().optional(),   // YYYY-MM-DD
  hotelCheckOut:    z.string().optional(),   // YYYY-MM-DD
  passengers:       z.array(PassengerSchema).min(1),
  childPassengers:  z.array(ChildPassengerSchema).default([]),
  originAirport:    z.string().optional(),
  guestNationality: z.string().default('CA'),
});

// ─── Placeholder detection ────────────────────────────────────────────────────

const PLACEHOLDER_RE = /^(<.*>|N\/A|TBD|pending|unknown|loading|undefined|null|example|test|sample)$/i;

function isPlaceholder(id: string | undefined): boolean {
  if (!id) return false;
  return (
    id.startsWith('<') ||
    id === 'off_'      ||
    id === 'amadeus_'  ||
    id === 'liteapi_'  ||
    id.length < 6      ||
    PLACEHOLDER_RE.test(id.trim())
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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
      { status: 400 },
    );
  }

  const {
    sessionId, paymentIntentId, flightOfferId, requestedPriceCents, hotelRateId, hotelName,
    hotelId, hotelCheckIn, hotelCheckOut,
    passengers, childPassengers, originAirport, guestNationality,
    flightOrigin, flightDestination, flightDepartureDate, flightCabinClass, flightPassengers,
  } = parsed.data;

  // ── Payment verification — gate all bookings behind confirmed Stripe payment ──
  // When STRIPE_SECRET_KEY is set (production), we REQUIRE a paid PaymentIntent
  // before touching any booking API. This prevents real Duffel/LiteAPI charges
  // from firing if the user hasn't paid the $20 service fee.
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    if (!paymentIntentId) {
      console.error('[book-trip] Stripe configured but no paymentIntentId provided — rejecting');
      return NextResponse.json(
        { success: false, error: 'Payment required before booking. Please complete the payment step.' },
        { status: 402 },
      );
    }
    try {
      const pi = await getPaymentIntent(paymentIntentId);
      if (pi.status !== 'succeeded') {
        console.warn('[book-trip] PaymentIntent not succeeded:', paymentIntentId, 'status:', pi.status);
        return NextResponse.json(
          { success: false, error: `Payment has not been confirmed (status: ${pi.status}). Please complete payment first.` },
          { status: 402 },
        );
      }
      console.log('[book-trip] Payment verified ✓', paymentIntentId, `$${(pi.amount / 100).toFixed(2)} ${pi.currency.toUpperCase()}`);
    } catch (verifyErr) {
      console.error('[book-trip] Payment verification error:', verifyErr);
      return NextResponse.json(
        { success: false, error: 'Could not verify payment. Please try again or contact support.' },
        { status: 502 },
      );
    }
  } else {
    // Stripe not configured — dev/sandbox mode, allow without PI
    if (paymentIntentId) {
      console.log('[book-trip] Stripe not configured — skipping PI verification for:', paymentIntentId);
    } else {
      console.warn('[book-trip] No Stripe key and no paymentIntentId — proceeding in dev/sandbox mode');
    }
  }

  // Clean up placeholder IDs emitted by the AI
  const resolvedFlight = isPlaceholder(flightOfferId) ? undefined : flightOfferId;
  const resolvedHotel  = isPlaceholder(hotelRateId)   ? undefined : hotelRateId;

  if (flightOfferId && !resolvedFlight) {
    console.warn('[book-trip] flightOfferId is a placeholder — skipping:', flightOfferId);
  }
  if (hotelRateId && !resolvedHotel) {
    console.warn('[book-trip] hotelRateId is a placeholder — skipping:', hotelRateId);
  }

  console.log('[book-trip]',
    'flight:', resolvedFlight ?? '(none)',
    '| hotel:', resolvedHotel ? resolvedHotel.slice(0, 30) + '…' : '(none)',
    '| adults:', passengers.length,
    '| children:', childPassengers.length,
  );

  // Delegate entirely to the booking agent (via orchestrator)
  const result = await book({
    sessionId:           sessionId ?? `anon_${Date.now()}`,
    flightOfferId:       resolvedFlight,
    requestedPriceCents,
    flightOrigin,
    flightDestination,
    flightDepartureDate,
    flightCabinClass,
    flightPassengers,
    hotelRateId:         resolvedHotel,
    hotelName,
    hotelId,
    hotelCheckIn,
    hotelCheckOut,
    passengers,
    childPassengers,
    originAirport,
    guestNationality,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        success:      false,
        error:        result.error,
        flightError:  result.error,
        hotelError:   undefined,
      },
      { status: 502 },
    );
  }

  const d = result.data!;

  // ── Persist passenger data for verification (chargebacks, airline disputes) ─
  // Non-blocking — booking already confirmed, we just log to DB.
  if (d.success) {
    const sid = sessionId ?? 'anon';
    const passengerRows = [
      ...passengers.map(p => ({
        session_id:    sid,
        booking_id:    null as string | null, // FK populated by webhook when booking row is created
        type:          'adult' as const,
        title:         (p.title ?? null) as string | null,
        first_name:    p.firstName,
        last_name:     p.lastName,
        date_of_birth: p.dateOfBirth,
        gender:        (p.gender ?? null) as string | null,
        nationality:   guestNationality ?? null,
        email:         p.email,
        phone:         p.phone,
      })),
      ...childPassengers.map(c => ({
        session_id:    sid,
        booking_id:    null as string | null,
        type:          'child' as const,
        title:         null as string | null,
        first_name:    c.firstName,
        last_name:     c.lastName,
        date_of_birth: c.dateOfBirth,
        gender:        (c.gender ?? null) as string | null,
        nationality:   guestNationality ?? null,
        email:         null as string | null,
        phone:         null as string | null,
      })),
    ];

    db.passengers.insertMany(passengerRows).catch(e =>
      console.warn('[book-trip] Passenger DB write failed (non-critical):', String(e))
    );
  }

  return NextResponse.json({
    success:              d.success,
    priceChanged:         d.priceChanged,
    newPriceCents:        d.newPriceCents,
    flightRef:            d.flightRef,
    flightError:          d.flightError,
    hotelRef:             d.hotelRef,
    hotelName:            d.hotelName,
    hotelError:           d.hotelError,
    clientSecret:         d.clientSecret,
    paymentIntentId:      d.paymentIntentId,
    currency:             d.currency,
    serviceFeeCents:      d.serviceFeeCents,
    tripId:               d.tripId,
    isSandboxBooking:     d.isSandboxBooking,
    // LiteAPI payment SDK (production only) — frontend renders payment widget using these
    requiresHotelPayment: d.requiresHotelPayment,
    hotelPrebookId:       d.hotelPrebookId,
    hotelSecretKey:       d.hotelSecretKey,
    hotelTransactionId:   d.hotelTransactionId,
    flexibilityScore: d.flexibilityScore
      ? {
          score:   d.flexibilityScore.score,
          label:   d.flexibilityScore.label,
          summary: d.flexibilityScore.summary,
        }
      : undefined,
  });
}
