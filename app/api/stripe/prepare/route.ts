// ─── /api/stripe/prepare ─────────────────────────────────────────────────────
// Creates a Stripe PaymentIntent for the selected payment strategy.
//
// For Canada / merchant-of-record balance mode, Stripe collects the flight fare
// plus FlexeTravels' transparent service fee, then /api/book-trip pays Duffel
// from Balance. For supplier-direct modes, Stripe can collect only the fee.
//
// Security:
//   - We look up Duffel offer IDs server-side when possible and ignore client
//     fare claims for the amount charged.
//   - The PI metadata stores expected amount/currency and offer IDs so
//     /api/book-trip can cross-verify before touching Duffel/LiteAPI.
//
// Flow:
//   1. Client calls this route with selected offer IDs + metadata
//   2. We fetch real offer prices from Duffel where a fare is collected
//   3. We create a strategy-specific PaymentIntent:
//        - stripe_balance: verified flight fare + transparent service fee
//        - supplier_direct: service fee only
//   4. Client mounts Stripe Elements using the returned clientSecret
//   5. User enters card and pays the disclosed amount
//   6. Client calls /api/book-trip with paymentIntentId as proof of payment
//   7. /api/book-trip verifies PI status, amount, currency, and metadata
//   8. Supplier booking runs only after payment verification

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { createPaymentIntent } from '@/lib/stripe';
import { db } from '@/lib/db/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import {
  buildCheckoutQuote,
  moneyToMinorUnits,
  type PaymentStrategy,
} from '@/lib/payments/strategy';
import { getRates } from '@/lib/fx/rates';

const SERVICE_FEE_CENTS = 2000; // $20.00
const SERVICE_FEE_AMOUNT = 20;
const SERVICE_FEE_CURRENCY = 'USD';

function quoteCartHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
}

const schema = z.object({
  bookingReference:  z.string().min(1),
  customerEmail:     z.string().email().optional(),
  paymentStrategy:   z.enum(['stripe_balance', 'supplier_direct']).default('stripe_balance'),
  // Single-leg flight offer ID — used to fetch real price from Duffel and to
  // pin the offer in PI metadata so /api/book-trip can detect bait-and-switch.
  flightOfferId:     z.string().optional(),
  // Multi-leg flight offer IDs (one per leg). When present, ALL of these are
  // pinned into PI metadata. /api/book-trip then verifies every leg's
  // flightOfferId is in this set — closes the bait-and-switch hole that
  // existed in the multi-leg path before this commit.
  flightOfferIds:    z.array(z.string().min(6).max(256)).max(10).optional(),
  flightItems:       z.array(z.object({
    offerId:  z.string().min(6).max(256),
    amount:   z.number().min(0).max(100_000),
    currency: z.string().min(3).max(3),
  })).max(10).optional(),
  // Client-provided price is ONLY used as a fallback for the description; actual price comes from Duffel
  flightPriceCents:  z.number().int().min(0).max(10_000_000).default(0),
  flightCurrency:    z.string().min(3).max(3).default('USD'),
  flightDescription: z.string().optional(),   // e.g. "YYZ → CUN (Air Canada)"
  hotelTotalCents:   z.number().int().min(0).optional(),  // informational only
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
    bookingReference, customerEmail, paymentStrategy, flightOfferId, flightOfferIds, flightItems,
    flightPriceCents: clientFlightPriceCents,
    flightCurrency, flightDescription, hotelTotalCents, passengerCount,
  } = parsed.data;

  const requestedOfferIds = (flightItems && flightItems.length > 0)
    ? flightItems.map(i => i.offerId)
    : (flightOfferIds && flightOfferIds.length > 0)
      ? flightOfferIds
      : (flightOfferId ? [flightOfferId] : []);

  if (clientFlightPriceCents > 0 && requestedOfferIds.length === 0) {
    return NextResponse.json(
      { error: 'A flight offer ID is required to charge a flight fare.' },
      { status: 400 },
    );
  }

  // ── Server-side price verification ────────────────────────────────────────
  // Prefer live Duffel lookups. In non-flight / unavailable cases, fall back to
  // explicit client line items only when no fare is being collected.
  let verifiedFlights: Array<{ offerId: string; priceCents: number; currency: string }> = [];
  if (requestedOfferIds.length > 0) {
    try {
      verifiedFlights = await Promise.all(
        requestedOfferIds.map(async id => {
          const p = await getDuffelOfferPrice(id);
          return { offerId: id, priceCents: p.priceCents, currency: p.currency.toUpperCase() };
        }),
      );
    } catch (e) {
      console.error('[/api/stripe/prepare] Duffel offer price fetch failed:', e);
      return NextResponse.json(
        { error: 'Could not verify flight price. Please try again.' },
        { status: 502 },
      );
    }
  } else {
    verifiedFlights = [];
  }

  const verifiedFlightItems = verifiedFlights.map(f => ({
    amount:   f.priceCents / 100,
    currency: f.currency,
  }));
  const fallbackCurrency = flightCurrency.toUpperCase();
  const provisionalFareCurrency = verifiedFlightItems[0]?.currency ?? fallbackCurrency;
  const rates = await getRates();
  const serviceFeeInFareCurrency = provisionalFareCurrency === SERVICE_FEE_CURRENCY
    ? SERVICE_FEE_AMOUNT
    : Math.round((SERVICE_FEE_AMOUNT * (rates.rates[provisionalFareCurrency] ?? 1)) * 100) / 100;

  const quote = buildCheckoutQuote({
    market: 'CA',
    supplier: 'duffel',
    flights: verifiedFlightItems.length > 0
      ? verifiedFlightItems
      : (clientFlightPriceCents > 0 ? [{ amount: clientFlightPriceCents / 100, currency: fallbackCurrency }] : []),
    serviceFeeAmount: serviceFeeInFareCurrency,
    serviceFeeCurrency: provisionalFareCurrency,
  });

  const strategy = paymentStrategy as PaymentStrategy;
  const chargeAmount = strategy === 'supplier_direct'
    ? SERVICE_FEE_CENTS
    : moneyToMinorUnits(quote.chargeAmount);
  const chargeCurrency = strategy === 'supplier_direct'
    ? 'usd'
    : quote.chargeCurrency.toLowerCase();

  if (strategy === 'stripe_balance' && quote.caveats.some(c => c.includes('mixed currencies'))) {
    return NextResponse.json(
      { error: 'Mixed flight currencies must be checked out separately.' },
      { status: 400 },
    );
  }

  // Build a human-readable description for the Stripe dashboard and receipt
  const flightLabel      = flightDescription ?? 'Flight';
  const flightCur        = quote.fareCurrency.toUpperCase();
  const verifiedFlightPriceCents = moneyToMinorUnits(quote.fareSubtotal);
  const flightFormatted  = verifiedFlightPriceCents > 0
    ? `$${(verifiedFlightPriceCents / 100).toFixed(2)} ${flightCur}`
    : '';
  const feeFormatted     = `${serviceFeeInFareCurrency.toFixed(2)} ${quote.chargeCurrency}`;
  const passengerSuffix  = passengerCount ? ` | Passengers: ${passengerCount}` : '';
  const hotelSuffix      = hotelTotalCents && hotelTotalCents > 0
    ? ` | Hotel: $${(hotelTotalCents / 100).toFixed(2)} ${flightCur} (separate)`
    : '';
  const description = flightFormatted
    ? `FlexeTravels checkout: ${flightLabel} flight ${flightFormatted} + service fee ${feeFormatted}${passengerSuffix}${hotelSuffix}`
    : `FlexeTravels service fee: ${feeFormatted} for ${flightLabel}${passengerSuffix}${hotelSuffix}`;

  try {
    const quoteRow = await db.paymentQuotes.create({
      session_id:           bookingReference,
      market:               'CA',
      strategy,
      merchant_of_record:   'FlexeTravels and Tours Inc.',
      supplier:             'duffel',
      fare_amount_cents:    verifiedFlightPriceCents,
      fare_currency:        flightCur,
      fee_amount_cents:     moneyToMinorUnits(serviceFeeInFareCurrency),
      fee_currency:         quote.chargeCurrency,
      charge_amount_cents:  chargeAmount,
      charge_currency:      chargeCurrency.toUpperCase(),
      offer_ids:            requestedOfferIds,
      cart_hash:            quoteCartHash({
        bookingReference,
        strategy,
        requestedOfferIds,
        verifiedFlights,
        chargeAmount,
        chargeCurrency,
        serviceFeeInFareCurrency,
        passengerCount,
      }),
      caveats:              quote.caveats,
      expires_at:           new Date(Date.now() + 15 * 60_000).toISOString(),
      status:               'open',
      metadata: {
        flightDescription: flightLabel,
        customerEmail: customerEmail ?? null,
        hotelTotalCents: hotelTotalCents ?? 0,
      },
    });

    const result = await createPaymentIntent({
      bookingReference,
      bookingType:   'flight',
      customerEmail,
      amount:        chargeAmount,
      currency:      chargeCurrency,
      description,
      metadata: {
        // /api/book-trip verifies pi.amount/currency against these values.
        expected_amount:    String(chargeAmount),
        expected_currency:  chargeCurrency,
        flight_offer_id:    flightOfferId ?? '',
        // Comma-separated set of every leg's flight offer ID. Used by
        // /api/book-trip to verify EVERY booked leg's offer was on the cart
        // when payment was made — closes the multi-leg bait-and-switch path.
        // Stripe metadata values must be ≤ 500 chars; we trim defensively.
        flight_offer_ids:   (requestedOfferIds.join(',')).slice(0, 500),
        flight_price_cents: String(verifiedFlightPriceCents),   // informational — charged by Duffel
        flight_currency:    flightCur,                           // informational — charged by Duffel
        service_fee_cents:  String(moneyToMinorUnits(serviceFeeInFareCurrency)),
        service_fee_currency: quote.chargeCurrency,
        service_fee_usd_cents: String(SERVICE_FEE_CENTS),
        total_cents:        String(chargeAmount),
        payment_strategy:   strategy,
        merchant_of_record: 'FlexeTravels and Tours Inc.',
        quote_id:           quoteRow?.id ?? '',
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
        strategy,
        flightCents:      verifiedFlightPriceCents,
        flightCurrency:   flightCur,
        serviceFeeCents:  moneyToMinorUnits(serviceFeeInFareCurrency),
        serviceFeeCurrency: quote.chargeCurrency,
        serviceFeeUsdCents: SERVICE_FEE_CENTS,
        chargeCents:      chargeAmount,
        chargeCurrency:   chargeCurrency.toUpperCase(),
        chargedNowLabel:  strategy === 'supplier_direct'
          ? 'FlexeTravels service fee'
          : 'Flight fare + FlexeTravels service fee',
        supplierPaymentLabel: strategy === 'supplier_direct'
          ? 'Supplier charges travel fare separately.'
          : 'FlexeTravels pays the airline from Duffel Balance after payment.',
        quoteId: quoteRow?.id,
      },
    });
  } catch (err) {
    console.error('[stripe/prepare] Error:', err);
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 });
  }
}
