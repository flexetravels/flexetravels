// ─── /api/book-trip — Thin Controller ─────────────────────────────────────────
// All booking logic lives in /lib/agents/booking.ts (via orchestrator).
// This route only: validates input → calls orchestrator → returns JSON.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { book } from '@/lib/orchestrator';
import { getPaymentIntent } from '@/lib/stripe';
import { db } from '@/lib/db/client';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

// ─── Request schema ────────────────────────────────────────────────────────────

// Name field length caps prevent DoS via huge payloads and truncate any
// HTML injection payload that might somehow reach downstream rendering.
const NAME_RE = /^[^\x00-\x1F<>\\]{1,100}$/;   // no control chars, no < > \

const PassengerSchema = z.object({
  firstName:   z.string().min(1).max(100).regex(NAME_RE, 'Invalid characters in first name'),
  lastName:    z.string().min(1).max(100).regex(NAME_RE, 'Invalid characters in last name'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  email:       z.string().email().max(254),
  phone:       z.string().min(6).max(30),
  title:       z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']).optional().default('mr'),
  gender:      z.enum(['m', 'f']).optional().default('m'),
  // Passport / travel document — required by Duffel for international flights
  passportNumber:         z.string().max(30).optional(),
  passportIssuingCountry: z.string().length(2).optional(),   // ISO 3166-1 alpha-2
  passportExpiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ChildPassengerSchema = z.object({
  firstName:   z.string().min(1).max(100).regex(NAME_RE, 'Invalid characters in first name'),
  lastName:    z.string().min(1).max(100).regex(NAME_RE, 'Invalid characters in last name'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required'),
  gender:      z.enum(['m', 'f']).optional().default('m'),
  // Passport / travel document
  passportNumber:         z.string().max(30).optional(),
  passportIssuingCountry: z.string().length(2).optional(),
  passportExpiry:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Multi-leg trip — one entry per leg. Each leg has its own optional flight
// offer and/or hotel rate. Top-level booking metadata (passengers, payment)
// is shared across all legs since passport details apply per person, not
// per flight, and we charge a single $20 service fee for the whole trip.
const TripLegSchema = z.object({
  flightOfferId:          z.string().max(256).optional(),
  requestedPriceCents:    z.number().int().min(0).max(10_000_000).optional(),
  flightOrigin:           z.string().max(10).optional(),
  flightDestination:      z.string().max(10).optional(),
  flightDepartureDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flightCabinClass:       z.string().max(20).optional(),
  flightPassengers:       z.number().int().min(1).max(9).optional(),
  hotelRateId:            z.string().max(512).optional(),
  hotelName:              z.string().max(200).optional(),
  hotelId:                z.string().max(50).optional(),
  hotelCheckIn:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hotelCheckOut:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const BodySchema = z.object({
  sessionId:              z.string().max(128).optional(),
  paymentIntentId:        z.string().max(128).optional(),  // Stripe PI — required when Stripe is configured
  // Single-leg shape (legacy /chat → /booking). Use either these top-level
  // fields OR the legs[] array below; never both.
  flightOfferId:          z.string().max(256).optional(),
  requestedPriceCents:    z.number().int().min(0).max(10_000_000).optional(),
  flightOrigin:           z.string().max(10).optional(),
  flightDestination:      z.string().max(10).optional(),
  flightDepartureDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flightCabinClass:       z.string().max(20).optional(),
  flightPassengers:       z.number().int().min(1).max(9).optional(),
  hotelRateId:            z.string().max(512).optional(),
  hotelName:              z.string().max(200).optional(),
  hotelId:                z.string().max(50).optional(),
  hotelCheckIn:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hotelCheckOut:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Multi-leg shape (canvas → /booking). When present + non-empty, the
  // route loops through each leg sequentially. Capped at 10 legs as a sanity
  // guard — anything beyond that is almost certainly a mistake and would
  // monopolise the booking endpoint for many minutes per request.
  legs:                   z.array(TripLegSchema).max(10).optional(),
  // Max 9 adults/children mirrors airline industry limits (Duffel caps at 9 pax per booking)
  passengers:             z.array(PassengerSchema).min(1).max(9),
  childPassengers:        z.array(ChildPassengerSchema).max(9).default([]),
  originAirport:          z.string().max(10).optional(),
  guestNationality:       z.string().length(2).default('CA'),
});

// ─── In-process idempotency guard ─────────────────────────────────────────────
// Prevents two concurrent POST /api/book-trip requests that carry the same
// PaymentIntentId from both reaching Duffel/LiteAPI.
//
// Attack scenario without this guard:
//   1. Attacker POSTs /api/book-trip twice in parallel with the same PI.
//   2. Both requests call getPaymentIntent → both see status 'succeeded'.
//   3. Both proceed to book the same flight → two Duffel orders for one payment.
//
// The lock is released via finally{} so a server crash / exception does not
// permanently block the PI.  Across multiple server instances a DB-based lock
// is needed (see TODO below), but this covers the single-process common case.
const processingPIs = new Set<string>();

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
  const ip = getClientIp(req);
  if (!rateLimit(`ip:book-trip:${ip}`, 3, 60_000)) {
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
      { status: 400 },
    );
  }

  const {
    sessionId, paymentIntentId, flightOfferId, requestedPriceCents, hotelRateId, hotelName,
    hotelId, hotelCheckIn, hotelCheckOut,
    passengers, childPassengers, originAirport, guestNationality,
    flightOrigin, flightDestination, flightDepartureDate, flightCabinClass, flightPassengers,
    legs,
  } = parsed.data;

  // Normalise to a leg array. Single-leg requests get wrapped into a one-leg
  // array so the orchestrator below has a single code path. Multi-leg
  // requests use the legs[] field directly.
  const allLegs = (legs && legs.length > 0)
    ? legs
    : [{
        flightOfferId,
        requestedPriceCents,
        flightOrigin,
        flightDestination,
        flightDepartureDate,
        flightCabinClass,
        flightPassengers,
        hotelRateId,
        hotelName,
        hotelId,
        hotelCheckIn,
        hotelCheckOut,
      }];

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

    // ── In-process idempotency lock ──────────────────────────────────────────
    // Reject concurrent requests carrying the same PI before either can book.
    // The lock is released in the finally block below, which runs for all code
    // paths (success, error, early-return).
    if (processingPIs.has(paymentIntentId)) {
      console.warn('[book-trip] Concurrent booking attempt for same PI — rejecting:', paymentIntentId);
      return NextResponse.json(
        { success: false, error: 'A booking for this payment is already in progress. Please wait.' },
        { status: 409 },
      );
    }
    processingPIs.add(paymentIntentId);
  }

  // ── Wrap the rest in try/finally so the PI lock is always released ─────────
  let verifiedPayment:
    | {
        id: string;
        amount: number;
        currency: string;
        quoteId?: string;
        metadata?: Record<string, string>;
      }
    | null = null;

  try {
    if (stripeKey && paymentIntentId) {
      try {
        const pi = await getPaymentIntent(paymentIntentId);
        if (pi.status !== 'succeeded') {
          console.warn('[book-trip] PaymentIntent not succeeded:', paymentIntentId, 'status:', pi.status);
          return NextResponse.json(
            { success: false, error: `Payment has not been confirmed (status: ${pi.status}). Please complete payment first.` },
            { status: 402 },
          );
        }

        // ── Metadata integrity checks — prevent price tampering ──────────────
        // Verify the PI amount matches what was stored in metadata at creation time
        const expectedAmount = pi.metadata?.expected_amount;
        if (expectedAmount !== undefined && parseInt(expectedAmount, 10) !== pi.amount) {
          console.error(
            '[book-trip] PI amount mismatch — tampering detected!',
            'pi.amount:', pi.amount,
            'metadata.expected_amount:', expectedAmount,
          );
          return NextResponse.json(
            { success: false, error: 'Payment verification failed' },
            { status: 402 },
          );
        }
        const expectedCurrency = pi.metadata?.expected_currency;
        if (expectedCurrency && expectedCurrency.toLowerCase() !== pi.currency.toLowerCase()) {
          console.error(
            '[book-trip] PI currency mismatch — tampering detected!',
            'pi.currency:', pi.currency,
            'metadata.expected_currency:', expectedCurrency,
          );
          return NextResponse.json(
            { success: false, error: 'Payment verification failed' },
            { status: 402 },
          );
        }

        // Verify the flight offer ID matches what was priced at PI creation time
        const piOfferId = pi.metadata?.flight_offer_id;
        if (piOfferId && flightOfferId && piOfferId !== flightOfferId) {
          console.error(
            '[book-trip] Flight offer ID mismatch — tampering detected!',
            'request flightOfferId:', flightOfferId,
            'metadata.flight_offer_id:', piOfferId,
          );
          return NextResponse.json(
            { success: false, error: 'Payment verification failed' },
            { status: 402 },
          );
        }

        // Multi-leg bait-and-switch guard. The PI metadata pins the set of
        // flight offer IDs that were on the cart when the user paid. Every
        // leg's flightOfferId must belong to that set — otherwise an
        // attacker who got past the $20 PI could submit `legs[]` containing
        // entirely different (e.g. more expensive) offers at booking time.
        const piOfferIds = (pi.metadata?.flight_offer_ids ?? '')
          .split(',').map(s => s.trim()).filter(Boolean);
        if (piOfferIds.length > 0 && legs && legs.length > 0) {
          const pinned   = new Set(piOfferIds);
          const violator = legs.find(l =>
            l.flightOfferId &&
            !isPlaceholder(l.flightOfferId) &&
            !pinned.has(l.flightOfferId),
          );
          if (violator) {
            console.error(
              '[book-trip] Multi-leg flight offer mismatch — tampering detected!',
              'unpinned offer:', violator.flightOfferId,
              'pinned set size:', pinned.size,
            );
            return NextResponse.json(
              { success: false, error: 'Payment verification failed' },
              { status: 402 },
            );
          }
        }

        const quoteId = pi.metadata?.quote_id?.trim() || undefined;
        if (quoteId) {
          const consumed = await db.paymentQuotes.consumeOpen(quoteId);
          if (!consumed) {
            console.warn('[book-trip] Quote already consumed or unavailable — rejecting duplicate/replay:', quoteId);
            return NextResponse.json(
              { success: false, error: 'This payment quote has already been used. Please contact support if you need help.' },
              { status: 409 },
            );
          }
        }

        const existingTx = await db.paymentTransactions.getByProviderPaymentId('stripe', paymentIntentId);
        if (existingTx && ['succeeded', 'refunding', 'refunded', 'partially_refunded'].includes(existingTx.status)) {
          console.warn('[book-trip] PaymentIntent already processed — rejecting duplicate:', paymentIntentId);
          return NextResponse.json(
            { success: false, error: 'This payment has already been processed.' },
            { status: 409 },
          );
        }

        if (quoteId) {
          await db.paymentTransactions.create({
            quote_id:               quoteId,
            provider:               'stripe',
            provider_payment_id:    paymentIntentId,
            idempotency_key:        `stripe:${paymentIntentId}`,
            status:                 'succeeded',
            amount_cents:           pi.amount,
            currency:               pi.currency.toUpperCase(),
            expected_amount_cents:  parseInt(pi.metadata?.expected_amount ?? String(pi.amount), 10),
            expected_currency:      (pi.metadata?.expected_currency ?? pi.currency).toUpperCase(),
            raw_payload: {
              metadata: pi.metadata ?? {},
              status: pi.status,
            },
          }).catch(e => console.warn('[book-trip] Payment transaction DB write failed:', String(e)));
        }

        verifiedPayment = {
          id: paymentIntentId,
          amount: pi.amount,
          currency: pi.currency.toUpperCase(),
          quoteId,
          metadata: pi.metadata,
        };

        console.log('[book-trip] Payment verified ✓', paymentIntentId, `$${(pi.amount / 100).toFixed(2)} ${pi.currency.toUpperCase()}`);
      } catch (verifyErr) {
        console.error('[book-trip] Payment verification error:', verifyErr);
        return NextResponse.json(
          { success: false, error: 'Could not verify payment. Please try again or contact support.' },
          { status: 502 },
        );
      }
    } else if (!stripeKey) {
      // Stripe not configured — dev/sandbox mode, allow without PI
      if (paymentIntentId) {
        console.log('[book-trip] Stripe not configured — skipping PI verification for:', paymentIntentId);
      } else {
        console.warn('[book-trip] No Stripe key and no paymentIntentId — proceeding in dev/sandbox mode');
      }
    }

    // ── Multi-leg orchestration ────────────────────────────────────────────
    // Each leg is booked sequentially via the existing book() orchestrator.
    // Sequential (not parallel) is deliberate: Duffel + LiteAPI both have
    // strict per-token concurrency limits, and a partial failure mid-trip
    // leaves later legs as "didn't even attempt" rather than "raced and
    // half-died." We bail past failures, keep going, and report per-leg.
    console.log('[book-trip]',
      'legs:', allLegs.length,
      '| adults:', passengers.length,
      '| children:', childPassengers.length,
    );

    const legResults: Array<{
      flightOfferId?: string;
      flightRef?:     string;
      flightError?:   string;
      hotelRateId?:   string;
      hotelName?:     string;
      hotelRef?:      string;
      hotelError?:    string;
      requiresHotelPayment?: boolean;
      hotelPrebookId?:       string;
      hotelSecretKey?:       string;
      hotelTransactionId?:   string;
      isSandboxBooking?: boolean;
      currency?:         string;
      newPriceCents?:    number;
      priceChanged?:     boolean;
      flexibilityScore?: { score: number; label: string; summary: string };
    }> = [];

    for (let i = 0; i < allLegs.length; i++) {
      const leg = allLegs[i];
      // Strip placeholder IDs (the AI sometimes emits "<offer-id>" stubs).
      const legFlight = isPlaceholder(leg.flightOfferId) ? undefined : leg.flightOfferId;
      const legHotel  = isPlaceholder(leg.hotelRateId)   ? undefined : leg.hotelRateId;
      if (leg.flightOfferId && !legFlight) {
        console.warn(`[book-trip] leg ${i + 1}: flightOfferId is a placeholder — skipping`, leg.flightOfferId);
      }
      if (leg.hotelRateId && !legHotel) {
        console.warn(`[book-trip] leg ${i + 1}: hotelRateId is a placeholder — skipping`, leg.hotelRateId);
      }
      if (!legFlight && !legHotel) {
        legResults.push({});
        continue;
      }

      console.log(`[book-trip] leg ${i + 1}/${allLegs.length}:`,
        'flight:', legFlight ?? '(none)',
        '| hotel:', legHotel ? legHotel.slice(0, 30) + '…' : '(none)',
      );

      try {
        const r = await book({
          sessionId:           sessionId ?? `anon_${Date.now()}`,
          flightOfferId:       legFlight,
          requestedPriceCents: leg.requestedPriceCents,
          flightOrigin:        leg.flightOrigin,
          flightDestination:   leg.flightDestination,
          flightDepartureDate: leg.flightDepartureDate,
          flightCabinClass:    leg.flightCabinClass,
          flightPassengers:    leg.flightPassengers,
          hotelRateId:         legHotel,
          hotelName:           leg.hotelName,
          hotelId:             leg.hotelId,
          hotelCheckIn:        leg.hotelCheckIn,
          hotelCheckOut:       leg.hotelCheckOut,
          passengers,
          childPassengers,
          originAirport,
          guestNationality,
        });
        if (!r.ok) {
          if (verifiedPayment?.quoteId) {
            await db.supplierBookings.create({
              quote_id: verifiedPayment.quoteId,
              leg_index: i,
              supplier: legFlight ? 'duffel' : 'liteapi',
              product_type: legFlight ? 'flight' : 'hotel',
              supplier_offer_id: legFlight ?? legHotel ?? null,
              status: 'failed',
              amount_cents: leg.requestedPriceCents ?? 0,
              currency: verifiedPayment.currency,
              failure_reason: r.error,
              raw_request: {
                flightOfferId: legFlight,
                hotelRateId: legHotel,
                hotelName: leg.hotelName,
              },
            }).catch(e => console.warn('[book-trip] Supplier booking failure DB write failed:', String(e)));
          }
          legResults.push({
            flightOfferId: legFlight,
            flightError:   r.error,
            hotelRateId:   legHotel,
            hotelName:     leg.hotelName,
            hotelError:    r.error,
          });
          continue;
        }
        const d = r.data!;
        if (verifiedPayment?.quoteId) {
          const supplierRows: Array<Partial<import('@/lib/db/client').SupplierBookingRow>> = [];
          if (legFlight || d.flightRef || d.flightError) {
            supplierRows.push({
              quote_id: verifiedPayment.quoteId,
              leg_index: i,
              supplier: 'duffel',
              product_type: 'flight',
              supplier_offer_id: legFlight ?? null,
              supplier_booking_id: d.flightRef ?? null,
              supplier_reference: d.flightRef ?? null,
              status: d.flightRef ? 'confirmed' : 'failed',
              amount_cents: leg.requestedPriceCents ?? 0,
              currency: d.currency ?? verifiedPayment.currency,
              failure_reason: d.flightError ?? null,
              raw_request: {
                flightOfferId: legFlight,
                origin: leg.flightOrigin,
                destination: leg.flightDestination,
                departureDate: leg.flightDepartureDate,
              },
              raw_response: { flightRef: d.flightRef, flightError: d.flightError },
            });
          }
          if (legHotel || d.hotelRef || d.hotelError) {
            supplierRows.push({
              quote_id: verifiedPayment.quoteId,
              leg_index: i,
              supplier: 'liteapi',
              product_type: 'hotel',
              supplier_offer_id: legHotel ?? null,
              supplier_booking_id: d.hotelRef ?? null,
              supplier_reference: d.hotelRef ?? null,
              status: d.hotelRef ? 'confirmed' : (d.requiresHotelPayment ? 'requires_action' : 'failed'),
              amount_cents: 0,
              currency: d.currency ?? verifiedPayment.currency,
              failure_reason: d.hotelError ?? null,
              raw_request: {
                hotelRateId: legHotel,
                hotelName: leg.hotelName,
                checkIn: leg.hotelCheckIn,
                checkOut: leg.hotelCheckOut,
              },
              raw_response: {
                hotelRef: d.hotelRef,
                hotelError: d.hotelError,
                requiresHotelPayment: d.requiresHotelPayment,
              },
            });
          }
          await Promise.all(supplierRows.map(row =>
            db.supplierBookings.create(row)
              .catch(e => console.warn('[book-trip] Supplier booking DB write failed:', String(e))),
          ));
        }
        legResults.push({
          flightOfferId:        legFlight,
          flightRef:            d.flightRef,
          flightError:          d.flightError,
          hotelRateId:          legHotel,
          hotelName:            d.hotelName ?? leg.hotelName,
          hotelRef:             d.hotelRef,
          hotelError:           d.hotelError,
          requiresHotelPayment: d.requiresHotelPayment,
          hotelPrebookId:       d.hotelPrebookId,
          hotelSecretKey:       d.hotelSecretKey,
          hotelTransactionId:   d.hotelTransactionId,
          isSandboxBooking:     d.isSandboxBooking,
          currency:             d.currency,
          newPriceCents:        d.newPriceCents,
          priceChanged:         d.priceChanged,
          flexibilityScore:     d.flexibilityScore,
        });
      } catch (legErr) {
        console.error(`[book-trip] leg ${i + 1} threw:`, legErr);
        if (verifiedPayment?.quoteId) {
          await db.supplierBookings.create({
            quote_id: verifiedPayment.quoteId,
            leg_index: i,
            supplier: legFlight ? 'duffel' : 'liteapi',
            product_type: legFlight ? 'flight' : 'hotel',
            supplier_offer_id: legFlight ?? legHotel ?? null,
            status: 'failed',
            amount_cents: leg.requestedPriceCents ?? 0,
            currency: verifiedPayment.currency,
            failure_reason: legErr instanceof Error ? legErr.message : 'unexpected error',
            raw_request: {
              flightOfferId: legFlight,
              hotelRateId: legHotel,
              hotelName: leg.hotelName,
            },
          }).catch(e => console.warn('[book-trip] Supplier booking exception DB write failed:', String(e)));
        }
        legResults.push({
          flightOfferId: legFlight,
          flightError:   legErr instanceof Error ? legErr.message : 'unexpected error',
          hotelRateId:   legHotel,
          hotelError:    legErr instanceof Error ? legErr.message : 'unexpected error',
        });
      }
    }

    // Aggregate verdict — any leg booked something? Any leg failed something?
    const anyFlightBooked = legResults.some(l => l.flightRef);
    const anyHotelBooked  = legResults.some(l => l.hotelRef);
    const anyFailure      = legResults.some(l => l.flightError || l.hotelError);
    const success         = anyFlightBooked || anyHotelBooked;

    if (verifiedPayment?.quoteId && verifiedPayment.amount > 0) {
      const serviceFeeCents = parseInt(verifiedPayment.metadata?.service_fee_cents ?? '2000', 10);
      const flightPriceCents = Math.max(0, verifiedPayment.amount - (Number.isFinite(serviceFeeCents) ? serviceFeeCents : 0));
      const ledgerRows = [
        {
          quote_id: verifiedPayment.quoteId,
          payment_transaction_id: null,
          account: 'stripe_cash' as const,
          direction: 'debit' as const,
          amount_cents: verifiedPayment.amount,
          currency: verifiedPayment.currency,
          memo: 'Customer card payment captured by Stripe',
        },
        ...(flightPriceCents > 0 ? [{
          quote_id: verifiedPayment.quoteId,
          payment_transaction_id: null,
          account: 'supplier_payable' as const,
          direction: 'credit' as const,
          amount_cents: flightPriceCents,
          currency: verifiedPayment.currency,
          memo: 'Fare amount payable through supplier balance',
        }] : []),
        ...(serviceFeeCents > 0 ? [{
          quote_id: verifiedPayment.quoteId,
          payment_transaction_id: null,
          account: 'service_fee_revenue' as const,
          direction: 'credit' as const,
          amount_cents: serviceFeeCents,
          currency: verifiedPayment.currency,
          memo: 'FlexeTravels transparent service fee',
        }] : []),
      ];
      db.ledgerEntries.createMany(ledgerRows)
        .catch(e => console.warn('[book-trip] Ledger DB write failed:', String(e)));
    }

    if (!success) {
      const firstError = legResults.find(l => l.flightError || l.hotelError);
      return NextResponse.json({
        success:      false,
        error:        firstError?.flightError ?? firstError?.hotelError ?? 'No bookings completed',
        flightError:  firstError?.flightError,
        hotelError:   firstError?.hotelError,
        legs:         legResults,
      }, { status: 502 });
    }

    // Synthetic single-leg result for backwards compat with the existing
    // success/error handling in CheckoutCard. The frontend can also render
    // the per-leg array directly when it wants the full picture.
    const first = legResults[0] ?? {};
    const d = {
      success,
      priceChanged:         first.priceChanged,
      newPriceCents:        first.newPriceCents,
      flightRef:            first.flightRef,
      flightError:          first.flightError,
      hotelRef:             first.hotelRef,
      hotelName:            first.hotelName,
      hotelError:           first.hotelError,
      // Stripe PI was already paid before this route ran; nothing further to charge
      clientSecret:         undefined as string | undefined,
      paymentIntentId,
      currency:             first.currency,
      serviceFeeCents:      2000,
      tripId:               undefined as string | undefined,
      isSandboxBooking:     first.isSandboxBooking,
      requiresHotelPayment: first.requiresHotelPayment,
      hotelPrebookId:       first.hotelPrebookId,
      hotelSecretKey:       first.hotelSecretKey,
      hotelTransactionId:   first.hotelTransactionId,
      flexibilityScore:     first.flexibilityScore,
    };
    void anyFailure;

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
      // Full per-leg result for multi-leg trips. Single-leg requests get a
      // one-element array (the values mirror the top-level fields).
      legs: legResults,
    });

  } finally {
    // Release the idempotency lock so a future retry (e.g. after a network error)
    // is allowed — but only after the booking attempt has fully completed.
    if (paymentIntentId) processingPIs.delete(paymentIntentId);
  }
}
