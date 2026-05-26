// ─── /api/stripe/prepare ─────────────────────────────────────────────────────
// Creates a Stripe PaymentIntent for:
//   • Flight fare     — the actual ticket price shown to the user
//   • Service fee     — FlexeTravels flat $20 booking fee
//
// Both are collected in a SINGLE Stripe charge so the customer enters their
// card details exactly once before any booking APIs are called.
//
// Security:
//   - If a flightOfferId is provided, we ALWAYS fetch the real price from Duffel
//     and ignore the client-provided flightPriceCents (prevents price tampering).
//   - If flightPriceCents > 0 but no flightOfferId, request is rejected —
//     we cannot verify the price without an offer reference.
//   - The PI metadata stores expected_amount and flight_offer_id so /api/book-trip
//     can cross-verify before touching Duffel/LiteAPI.
//
// Flow:
//   1. Client calls this route with flightOfferId + metadata
//   2. We fetch real offer price from Duffel
//   3. We create a PaymentIntent for (realFlightPriceCents + 2000) in Stripe
//   4. Client mounts Stripe Elements using the returned clientSecret
//   5. User enters card and pays
//   6. Client calls /api/book-trip with paymentIntentId as proof of payment
//   7. /api/book-trip verifies PI status === 'succeeded' + metadata integrity

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPaymentIntent } from '@/lib/stripe';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { calculateServiceFeeTax, SERVICE_FEE_CENTS } from '@/lib/tax';
import { createPaymentQuoteRecord } from '@/lib/payments/ledger';

const schema = z.object({
  sessionId:         z.string().max(128).optional(),
  bookingReference:  z.string().min(1),
  customerEmail:     z.string().email().optional(),
  // Flight offer ID — required when charging a flight fare; used to fetch real price from Duffel
  flightOfferId:     z.string().optional(),
  // Client-provided price is ONLY used as a fallback for the description; actual price comes from Duffel
  flightPriceCents:  z.number().int().min(0).max(600_000).default(0),   // max $6 000 per pax
  flightCurrency:    z.string().min(3).max(3).default('USD'),
  flightDescription: z.string().optional(),   // e.g. "YYZ → CUN (Air Canada)"
  hotelRateId:       z.string().max(512).optional(),
  hotelTotalCents:   z.number().int().min(0).optional(),  // informational only — not charged here
  passengerCount:    z.number().int().min(1).optional(),  // total passengers for metadata
  acceptPriceChange: z.boolean().default(false),
  billingCountry:    z.string().length(2).default('CA'),
  billingRegion:     z.string().min(2).max(3).default('BC'),
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
    sessionId, bookingReference, customerEmail, flightOfferId,
    flightPriceCents: clientFlightPriceCents,
    flightCurrency, flightDescription, hotelRateId, hotelTotalCents, passengerCount, acceptPriceChange,
    billingCountry, billingRegion,
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

    const clientCurrency = flightCurrency.toLowerCase();
    const priceDiffers = clientFlightPriceCents > 0 && clientFlightPriceCents !== verifiedFlightPriceCents;
    const currencyDiffers = clientCurrency !== verifiedCurrency;
    if ((priceDiffers || currencyDiffers) && !acceptPriceChange) {
      const changedTax = calculateServiceFeeTax({
        amountCents: SERVICE_FEE_CENTS,
        country: billingCountry,
        region: billingRegion,
      });
      return NextResponse.json(
        {
          error: 'Flight fare changed. Please review the updated fare before payment.',
          code: 'FLIGHT_PRICE_CHANGED',
          selectedFlightPriceCents: clientFlightPriceCents,
          verifiedFlightPriceCents,
          selectedCurrency: clientCurrency.toUpperCase(),
          verifiedCurrency: verifiedCurrency.toUpperCase(),
          serviceFeeCents: SERVICE_FEE_CENTS,
          serviceFeeTaxCents: changedTax.taxCents,
          serviceFeeTaxLabel: changedTax.taxLabel,
          totalCents: verifiedFlightPriceCents + SERVICE_FEE_CENTS + changedTax.taxCents,
        },
        { status: 409 },
      );
    }

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

  const serviceFeeTax = calculateServiceFeeTax({
    amountCents: SERVICE_FEE_CENTS,
    country: billingCountry,
    region: billingRegion,
  });
  const totalAmount = verifiedFlightPriceCents + SERVICE_FEE_CENTS + serviceFeeTax.taxCents;

  if (totalAmount <= 0) {
    return NextResponse.json({ error: 'Invalid total amount' }, { status: 400 });
  }

  // Build a human-readable description for the Stripe dashboard and receipt
  const flightLabel      = flightDescription ?? 'Flight';
  const cur              = verifiedCurrency.toUpperCase();
  const flightFormatted  = `$${(verifiedFlightPriceCents / 100).toFixed(2)} ${cur}`;
  const feeFormatted     = `$${(SERVICE_FEE_CENTS  / 100).toFixed(2)} ${cur}`;
  const taxFormatted     = `$${(serviceFeeTax.taxCents / 100).toFixed(2)} ${cur}`;
  const totalFormatted   = `$${(totalAmount         / 100).toFixed(2)} ${cur}`;
  const passengerSuffix  = passengerCount ? ` | Passengers: ${passengerCount}` : '';
  const hotelSuffix      = hotelTotalCents && hotelTotalCents > 0
    ? ` | Hotel: $${(hotelTotalCents / 100).toFixed(2)} ${cur} (separate)`
    : '';
  const taxPart = serviceFeeTax.taxCents > 0 ? ` + ${serviceFeeTax.taxLabel} ${taxFormatted}` : '';
  const description = `FlexeTravels booking: ${flightLabel} ${flightFormatted} + service fee ${feeFormatted}${taxPart} = ${totalFormatted}${passengerSuffix}${hotelSuffix}`;

  try {
    const quote = await createPaymentQuoteRecord({
      sessionId,
      bookingReference,
      market: billingCountry === 'CA' || billingCountry === 'US' ? billingCountry : 'OTHER',
      supplier: flightOfferId && hotelRateId ? 'mixed' : flightOfferId ? 'duffel' : 'liteapi',
      flightOfferId,
      hotelRateId,
      fareAmountCents: verifiedFlightPriceCents,
      fareCurrency: verifiedCurrency,
      feeAmountCents: SERVICE_FEE_CENTS,
      feeCurrency: verifiedCurrency,
      taxCents: serviceFeeTax.taxCents,
      taxLabel: serviceFeeTax.taxLabel,
      chargeAmountCents: totalAmount,
      chargeCurrency: verifiedCurrency,
      metadata: {
        customer_email_present: !!customerEmail,
        passenger_count: passengerCount ?? 1,
        hotel_total_cents: hotelTotalCents ?? 0,
        billing_country: serviceFeeTax.country,
        billing_region: serviceFeeTax.region,
        service_fee_tax_rate_bps: serviceFeeTax.taxRateBps,
        service_fee_tax_jurisdiction: serviceFeeTax.jurisdiction,
      },
    }).catch(e => {
      console.warn('[stripe/prepare] payment quote write failed:', String(e));
      return null;
    });

    const result = await createPaymentIntent({
      bookingReference,
      bookingType:   flightOfferId ? 'flight' : 'hotel',
      customerEmail,
      amount:        totalAmount,
      currency:      verifiedCurrency,
      description,
      metadata: {
        // Stored so /api/book-trip can verify no tampering occurred between prepare and book
        expected_amount:    String(totalAmount),
        flight_offer_id:    flightOfferId ?? '',
        flight_price_cents: String(verifiedFlightPriceCents),
        service_fee_cents:  String(SERVICE_FEE_CENTS),
        service_fee_tax_cents: String(serviceFeeTax.taxCents),
        service_fee_tax_label: serviceFeeTax.taxLabel,
        service_fee_tax_rate_bps: String(serviceFeeTax.taxRateBps),
        service_fee_tax_jurisdiction: serviceFeeTax.jurisdiction,
        payment_quote_id: quote?.id ?? '',
        billing_country: serviceFeeTax.country,
        billing_region: serviceFeeTax.region,
        total_cents:        String(totalAmount),
        flight_description: flightLabel,
        booking_reference:  bookingReference,
        passenger_count:    String(passengerCount ?? 1),
        hotel_total_cents:  String(hotelTotalCents ?? 0),
      },
    });

    return NextResponse.json({
      clientSecret:    result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      paymentQuoteId:  quote?.id,
      amount:          result.amount,
      currency:        result.currency,
      // Breakdown so the frontend can display what's being charged
      breakdown: {
        flightCents:     verifiedFlightPriceCents,
        serviceFeeCents: SERVICE_FEE_CENTS,
        serviceFeeTaxCents: serviceFeeTax.taxCents,
        serviceFeeTaxLabel: serviceFeeTax.taxLabel,
        serviceFeeTaxRateBps: serviceFeeTax.taxRateBps,
        serviceFeeTaxJurisdiction: serviceFeeTax.jurisdiction,
        billingCountry: serviceFeeTax.country,
        billingRegion: serviceFeeTax.region,
        totalCents:      totalAmount,
        currency:        verifiedCurrency.toUpperCase(),
      },
    });
  } catch (err) {
    console.error('[stripe/prepare] Error:', err);
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 });
  }
}
