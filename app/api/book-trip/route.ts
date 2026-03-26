// ─── /api/book-trip — Thin Controller ─────────────────────────────────────────
// All booking logic lives in /lib/agents/booking.ts (via orchestrator).
// This route only: validates input → calls orchestrator → returns JSON.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { book } from '@/lib/orchestrator';

// ─── Request schema ────────────────────────────────────────────────────────────

const PassengerSchema = z.object({
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  email:       z.string().email(),
  phone:       z.string().min(6),
});

const ChildPassengerSchema = z.object({
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
});

const BodySchema = z.object({
  sessionId:        z.string().optional(),
  flightOfferId:    z.string().optional(),
  hotelRateId:      z.string().optional(),
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
    sessionId, flightOfferId, hotelRateId, hotelName,
    hotelId, hotelCheckIn, hotelCheckOut,
    passengers, childPassengers, originAirport, guestNationality,
  } = parsed.data;

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
    sessionId:        sessionId ?? `anon_${Date.now()}`,
    flightOfferId:    resolvedFlight,
    hotelRateId:      resolvedHotel,
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
  return NextResponse.json({
    success:              d.success,
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
