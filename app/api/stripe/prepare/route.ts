// ─── /api/stripe/prepare ─────────────────────────────────────────────────────
// Creates a Stripe PaymentIntent for FlexeTravels' flat $20 USD service fee only.
// The flight fare itself is collected by Duffel at order creation time in the
// airline's native currency — NOT through Stripe. Mixing the two into one PI
// produced nonsense totals (e.g. "€1,220" when flight was €1,200 EUR + $20 USD).
//
// Security:
//   - We still look up the flight offer by ID (when provided) to surface the
//     verified flight price/currency in the response breakdown, but those cents
//     are NOT added to the PI amount.
//   - PI is always created for 2000 USD cents.
//   - The PI metadata stores expected_amount (= 2000) and flight_offer_id so
//     /api/book-trip can cross-verify before touching Duffel/LiteAPI.
//
// Flow:
//   1. Client calls this route with flightOfferId + metadata
//   2. We (optionally) fetch real offer price from Duffel for the receipt line
//   3. We create a PaymentIntent for $20 USD in Stripe
//   4. Client mounts Stripe Elements using the returned clientSecret
//   5. User enters card and pays the $20 service fee
//   6. Client calls /api/book-trip with paymentIntentId as proof of payment
//   7. /api/book-trip verifies PI status === 'succeeded' + metadata integrity
//   8. Duffel charges the flight separately to the same card at order time

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPaymentIntent } from '@/lib/stripe';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const SERVICE_FEE_CENTS = 2000; // $20.00

const schema = z.object({
  bookingReference:  z.string().min(1),
  customerEmail:     z.string().email().optional(),
  // Flight offer ID — required when charging a flight fare; used to fetch real price from Duffel
  flightOfferId:     z.string().optional(),
  // Client-provided price is ONLY used as a fallback for the description; actual price comes from Duffel
  flightPriceCents:  z.number().int().min(0).max(600_000).default(0),   // max $6 000 per pax
  flightCurrency:    z.string().min(3).max(3).default('USD'),
  flightDescription: z.string().optional(),   // e.g. "YYZ → CUN (Air Canada)"
  hotelTotalCents:   z.number().int().min(0).optional(),  // informational only — not charged here
  passengerCount:    z.number().int().min(1).optional(),  // total passengers for metadata
});

/** Fetch the real offer price from Duffel by offer ID.
 *  Returns { priceCents, currency } or throws. */
async function getDuffelOfferPrice(offerId: string): Promise<{ priceCents: number; currency: string }> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) throw new Error('DUFFEL_ACCESS_TOKEN not configured');

  const res = await fetch(`https://api.duffel.com/air/offers/${encodeURIComponent(offerId)}`, {
    headers: {
      Authorization:    `Bearer ${token}`,
      'Duffel-Version': 'v2',
      Accept:           'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Duffel offer lookup failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const body = await res.json() as {
    data?: { total_amount?: string; total_currency?: string };
  };

  const totalAmount   = body.data?.total_amount;
  const totalCurrency = body.data?.total_currency;

  if (!totalAmount || !totalCurrency) {
    throw new Error('Duffel offer response missing total_amount or total_currency');
  }

  // Duffel returns amounts as decimal strings (e.g. "1234.56")
  const priceCents = Math.round(parseFloat(totalAmount) * 100);
  if (isNaN(priceCents) || priceCents < 0) {
    throw new Error(`Invalid Duffel offer price: ${totalAmount}`);
  }

  return { priceCents, currency: totalCurrency.toLowerCase() };
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (!rateLimit(`ip:stripe/prepare:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey?.trim()) {
    return NextResponse.json(
      { error: 'Payment not yet configured.' },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    bookingReference, customerEmail, flightOfferId,
    flightPriceCents: clientFlightPriceCents,
    flightCurrency, flightDescription, hotelTotalCents, passengerCount,
  } = parsed.data;

  // ── Server-side price verification ────────────────────────────────────────
  // If a flight offer is included, fetch the real price from Duffel.
  // If the client claims a non-zero flight price but provides no offer ID, reject.
  let verifiedFlightPriceCents: number;
  let verifiedCurrency: string;

  if (flightOfferId) {
    // Fetch actual price from Duffel — ignore client-provided price
    let offerPrice: { priceCents: number; currency: string };
    try {
      offerPrice = await getDuffelOfferPrice(flightOfferId);
    } catch (e) {
      console.error('[/api/stripe/prepare] Duffel offer price fetch failed:', e);
      return NextResponse.json(
        { error: 'Could not verify flight price. Please try again.' },
        { status: 502 },
      );
    }
    verifiedFlightPriceCents = offerPrice.priceCents;
    verifiedCurrency         = offerPrice.currency;
    console.log(
      '[/api/stripe/prepare] Duffel price verified:',
      `${verifiedFlightPriceCents} cents ${verifiedCurrency.toUpperCase()}`,
      `(client claimed: ${clientFlightPriceCents} cents)`,
    );
  } else if (clientFlightPriceCents > 0) {
    // Client is claiming a non-zero flight price without a verifiable offer ID — reject
    return NextResponse.json(
      { error: 'A flight offer ID is required to charge a flight fare.' },
      { status: 400 },
    );
  } else {
    // No flight (hotel-only or service-fee-only) — charge only the service fee
    verifiedFlightPriceCents = 0;
    verifiedCurrency         = flightCurrency.toLowerCase();
  }

  // The Stripe PaymentIntent always charges exactly the flat $20 USD service fee.
  // The flight fare is charged separately by Duffel in its native currency at order time.
  const chargeAmount   = SERVICE_FEE_CENTS;
  const chargeCurrency = 'usd';

  // Build a human-readable description for the Stripe dashboard and receipt
  const flightLabel      = flightDescription ?? 'Flight';
  const flightCur        = verifiedCurrency.toUpperCase();
  const flightFormatted  = verifiedFlightPriceCents > 0
    ? `$${(verifiedFlightPriceCents / 100).toFixed(2)} ${flightCur} (charged by airline)`
    : '';
  const feeFormatted     = `$${(SERVICE_FEE_CENTS / 100).toFixed(2)} USD`;
  const passengerSuffix  = passengerCount ? ` | Passengers: ${passengerCount}` : '';
  const hotelSuffix      = hotelTotalCents && hotelTotalCents > 0
    ? ` | Hotel: $${(hotelTotalCents / 100).toFixed(2)} ${flightCur} (separate)`
    : '';
  const description = flightFormatted
    ? `FlexeTravels service fee: ${feeFormatted} for ${flightLabel} ${flightFormatted}${passengerSuffix}${hotelSuffix}`
    : `FlexeTravels service fee: ${feeFormatted} for ${flightLabel}${passengerSuffix}${hotelSuffix}`;

  try {
    const result = await createPaymentIntent({
      bookingReference,
      bookingType:   'flight',
      customerEmail,
      amount:        chargeAmount,
      currency:      chargeCurrency,
      description,
      metadata: {
        // /api/book-trip verifies pi.amount === expected_amount + pi.currency === 'usd'
        expected_amount:    String(chargeAmount),
        expected_currency:  chargeCurrency,
        flight_offer_id:    flightOfferId ?? '',
        flight_price_cents: String(verifiedFlightPriceCents),   // informational — charged by Duffel
        flight_currency:    flightCur,                           // informational — charged by Duffel
        service_fee_cents:  String(SERVICE_FEE_CENTS),
        total_cents:        String(chargeAmount),
        flight_description: flightLabel,
        booking_reference:  bookingReference,
        passenger_count:    String(passengerCount ?? 1),
        hotel_total_cents:  String(hotelTotalCents ?? 0),
      },
    });

    return NextResponse.json({
      clientSecret:    result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount:          result.amount,
      currency:        result.currency,
      // Breakdown so the frontend can display what's being charged where
      breakdown: {
        flightCents:      verifiedFlightPriceCents,  // NOT charged here — Duffel charges at order time
        flightCurrency:   flightCur,
        serviceFeeCents:  SERVICE_FEE_CENTS,
        serviceFeeCurrency: 'USD',
        chargeCents:      chargeAmount,
        chargeCurrency:   chargeCurrency.toUpperCase(),
      },
    });
  } catch (err) {
    console.error('[stripe/prepare] Error:', err);
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 });
  }
}
