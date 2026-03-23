// ─── /api/book-trip ────────────────────────────────────────────────────────────
// Books flight (Duffel) + hotel (LiteAPI) in one shot, then creates a Stripe
// PaymentIntent for the $20 FlexeTravels service fee.
// Called by the CheckoutCard component after the user fills in passenger details.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { liteApiPrebook, liteApiBook } from '@/lib/search/liteapi';
import { createPaymentIntent } from '@/lib/stripe';

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
  // Flight — Duffel offer ID (off_xxx) or 'skip' if flight-only isn't needed
  flightOfferId:   z.string().optional(),
  // Hotel — LiteAPI rateId from bookingToken
  hotelRateId:     z.string().optional(),
  hotelName:       z.string().optional(),
  // Adult passenger details (for both flight + hotel lead guest)
  passengers:      z.array(PassengerSchema).min(1),
  // Child passenger details (name + DOB; no email/phone required)
  childPassengers: z.array(ChildPassengerSchema).default([]),
  // Origin airport (for CAD vs USD currency detection)
  originAirport:   z.string().optional(),
  // Guest nationality for hotel (ISO 2-letter)
  guestNationality: z.string().default('US'),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

// ─── Duffel flight booking ─────────────────────────────────────────────────────

async function bookDuffelFlight(
  offerId: string,
  passengers: z.infer<typeof PassengerSchema>[],
  childPassengers: z.infer<typeof ChildPassengerSchema>[] = [],
): Promise<{ success: boolean; bookingRef?: string; totalAmount?: string; currency?: string; error?: string }> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return { success: false, error: 'Duffel not configured' };

  const headers = {
    Authorization:    `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type':   'application/json',
    Accept:           'application/json',
  };

  // Step 1: fetch live offer to get passenger IDs + confirmed total
  const offerRes = await fetch(`https://api.duffel.com/air/offers/${offerId}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });

  if (!offerRes.ok) {
    const txt = await offerRes.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.errors?.[0]?.message ?? txt.slice(0, 300);
    const gone = offerRes.status === 404 || offerRes.status === 422;
    console.error('[book-trip] Duffel offer fetch failed', offerRes.status, msg);
    return { success: false, error: gone ? 'Flight offer expired — please search again for fresh prices.' : `Offer fetch failed (${offerRes.status}): ${msg}` };
  }

  const offerData = await offerRes.json() as {
    data?: {
      passengers?:     Array<{ id: string }>;
      total_amount?:   string;
      total_currency?: string;
    };
  };

  const offerPassengers = offerData.data?.passengers ?? [];
  const totalAmount     = offerData.data?.total_amount ?? '0';
  const totalCurrency   = offerData.data?.total_currency ?? 'USD';

  if (offerPassengers.length === 0) {
    return { success: false, error: 'Offer returned no passenger slots. Please search again.' };
  }

  // Map offer passenger slots to our data.
  // Duffel slots come typed ('adult' / 'child'); we fill adults first, then children.
  // If the offer was searched adults-only, child slots won't be present — that's fine,
  // children's DOBs are still collected for hotel occupancy.
  let adultIdx = 0;
  let childIdx = 0;
  const passengerMap = offerPassengers.map((offerPax) => {
    const isChild = (offerPax as { type?: string }).type === 'child';
    if (isChild && childIdx < childPassengers.length) {
      const c = childPassengers[childIdx++];
      return {
        id:           offerPax.id,
        title:        'mr' as const,
        gender:       'm'  as const,
        given_name:   c.firstName,
        family_name:  c.lastName,
        born_on:      c.dateOfBirth,
        // Children don't have email/phone — use lead passenger's as placeholder
        email:        passengers[0].email,
        phone_number: normalizePhone(passengers[0].phone),
      };
    } else {
      const p = passengers[Math.min(adultIdx++, passengers.length - 1)];
      return {
        id:           offerPax.id,
        title:        'mr' as const,
        gender:       'm'  as const,
        given_name:   p.firstName,
        family_name:  p.lastName,
        born_on:      p.dateOfBirth,
        email:        p.email,
        phone_number: normalizePhone(p.phone),
      };
    }
  });

  // Step 2: create order
  const orderRes = await fetch('https://api.duffel.com/air/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type:            'instant',
        selected_offers: [offerId],
        passengers:      passengerMap,
        payments: [{
          type:     'balance',
          amount:   totalAmount,
          currency: totalCurrency,
        }],
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!orderRes.ok) {
    const txt = await orderRes.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.errors?.[0]?.message ?? txt.slice(0, 300);
    console.error('[book-trip] Duffel order create failed', orderRes.status, msg);
    return { success: false, error: `Flight booking failed (${orderRes.status}): ${msg}` };
  }

  const order = await orderRes.json() as {
    data?: { booking_reference?: string; total_amount?: string; total_currency?: string };
  };

  return {
    success:     true,
    bookingRef:  order.data?.booking_reference,
    totalAmount: order.data?.total_amount ?? totalAmount,
    currency:    order.data?.total_currency ?? totalCurrency,
  };
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { flightOfferId, hotelRateId, hotelName, passengers, childPassengers, originAirport, guestNationality } = parsed.data;

  // ── Intake log — helps debug missing offer IDs ──────────────────────────────
  console.log('[book-trip] intake —',
    'flightOfferId:', flightOfferId ?? '(none)',
    '| hotelRateId:', hotelRateId ? hotelRateId.slice(0, 30) + '…' : '(none)',
    '| adults:', passengers.length,
    '| children:', childPassengers.length,
  );

  // Detect truncated/placeholder offer IDs emitted by the AI (e.g. "<id>", "off_", "")
  const flightIdLooksSuspicious =
    flightOfferId && (
      flightOfferId.startsWith('<') ||
      flightOfferId === 'off_' ||
      flightOfferId.length < 6
    );
  if (flightIdLooksSuspicious) {
    console.warn('[book-trip] flightOfferId looks like a placeholder — ignoring:', flightOfferId);
  }
  const resolvedFlightOfferId = flightIdLooksSuspicious ? undefined : flightOfferId;

  // Calculate child ages from DOBs (needed for LiteAPI occupancy)
  const childAges = childPassengers.map(c => {
    const born  = new Date(c.dateOfBirth);
    const today = new Date();
    const age   = today.getFullYear() - born.getFullYear()
      - (today < new Date(today.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
    return Math.max(0, Math.min(17, age)); // clamp to valid range
  });
  const leadPassenger = passengers[0];

  let flightRef: string | undefined;
  let flightError: string | undefined;
  let hotelRef: string | undefined;
  let hotelError: string | undefined;

  // ── 1. Book flight ─────────────────────────────────────────────────────────
  if (resolvedFlightOfferId && !resolvedFlightOfferId.startsWith('amadeus_')) {
    try {
      const result = await bookDuffelFlight(resolvedFlightOfferId, passengers, childPassengers);
      if (result.success) {
        flightRef = result.bookingRef;
      } else {
        flightError = result.error;
      }
    } catch (e) {
      flightError = `Flight booking error: ${String(e)}`;
      console.error('[book-trip] Duffel exception:', e);
    }
  }

  // ── 2. Book hotel (LiteAPI: prebook → book) ────────────────────────────────
  if (hotelRateId) {
    try {
      if (hotelRateId.startsWith('liteapi_')) {
        // Strip prefix to get the raw LiteAPI offerId
        const offerId = hotelRateId.replace('liteapi_', '');

        // Step 2a: Prebook — confirms price + returns prebookId
        const prebook = await liteApiPrebook(offerId, guestNationality);
        if (!prebook.success || !prebook.prebookId) {
          hotelError = prebook.error ?? 'Hotel prebook failed';
          console.error('[book-trip] LiteAPI prebook failed:', hotelError);
        } else {
          console.log('[book-trip] LiteAPI prebook ok, prebookId:', prebook.prebookId,
            'total:', prebook.confirmedTotal, prebook.currency);

          // Step 2b: Book — charges the sandbox card and creates the reservation
          const book = await liteApiBook({
            prebookId:      prebook.prebookId,
            guestFirstName: leadPassenger.firstName,
            guestLastName:  leadPassenger.lastName,
            guestEmail:     leadPassenger.email,
          });
          if (book.success) {
            hotelRef = book.bookingId;
            console.log('[book-trip] LiteAPI booked:', hotelRef, book.hotelName);
          } else {
            hotelError = book.error ?? 'Hotel booking failed';
            console.error('[book-trip] LiteAPI book failed:', hotelError);
          }
        }
      } else {
        hotelError = `Unrecognised hotel token format: ${hotelRateId.slice(0, 40)}`;
        console.error('[book-trip] Unknown hotelRateId format:', hotelRateId);
      }
    } catch (e) {
      hotelError = `Hotel booking error: ${String(e)}`;
      console.error('[book-trip] Hotel exception:', e);
    }
  }

  // If nothing succeeded at all, abort before charging Stripe
  const attemptedSomething = !!(resolvedFlightOfferId || hotelRateId);
  if (attemptedSomething && !flightRef && !hotelRef) {
    return NextResponse.json({
      success: false,
      flightError,
      hotelError,
      error: flightError ?? hotelError ?? 'Both flight and hotel booking failed',
    }, { status: 502 });
  }

  // ── 3. Create Stripe PaymentIntent for service fee ────────────────────────
  // Currency: CAD for Canadian origin airports (IATA starts with Y), USD otherwise
  const origin   = (originAirport ?? '').toUpperCase();
  const currency = origin.startsWith('Y') ? 'cad' : 'usd';
  const bookingRef = flightRef ?? hotelRef ?? `FT-${Date.now()}`;

  let clientSecret: string | undefined;
  let paymentIntentId: string | undefined;

  try {
    const pi = await createPaymentIntent({
      bookingReference: bookingRef,
      bookingType:      flightRef ? 'flight' : 'hotel',
      customerEmail:    leadPassenger.email,
      amount:           2000,
      currency,
    });
    clientSecret    = pi.clientSecret;
    paymentIntentId = pi.paymentIntentId;
  } catch (e) {
    console.error('[book-trip] Stripe error:', e);
    // Don't block — booking succeeded, just can't collect fee right now
  }

  return NextResponse.json({
    success:         true,
    flightRef,
    flightError,
    hotelRef,
    hotelName,
    hotelError,
    clientSecret,
    paymentIntentId,
    currency,
    serviceFeeCents: 2000,
  });
}
