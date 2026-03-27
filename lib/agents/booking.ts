// ─── Booking Agent ─────────────────────────────────────────────────────────────
// Coordinates flight (Duffel) + hotel (LiteAPI) booking in sequence,
// then creates a Stripe PaymentIntent for the $20 FlexeTravels service fee.
//
// On partial success (one leg books, other fails) the agent still returns ok=true
// with per-leg error fields so the frontend can show the user what happened.
//
// DB persistence is handled by the orchestrator after this agent returns.

import type { BookingRequest, BookingResult, AgentResult } from '@/lib/orchestrator/types';
import { scoreFlexibility } from '@/lib/scoring/flexibility';
import type { DuffelConditions } from '@/lib/scoring/flexibility';
import { liteApiPrebook, liteApiBook, liteApiGetFreshOfferId } from '@/lib/search/liteapi';
import { createPaymentIntent } from '@/lib/stripe';
import { logger } from '@/lib/logger';

// ─── Duffel helper types ──────────────────────────────────────────────────────

interface DuffelOfferDetail {
  passengers?:     Array<{ id: string; type?: string }>;
  total_amount?:   string;
  total_currency?: string;
  conditions?:     DuffelConditions;
}

// ─── Normalise phone numbers to E.164 ─────────────────────────────────────────

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

// ─── Duffel flight booking ────────────────────────────────────────────────────

// Price tolerance: if the live price differs from the requested price by more
// than this amount (in the offer currency), we surface a PRICE_CHANGED error.
// This prevents customers being charged a stale rate without re-confirming.
const PRICE_CHANGE_TOLERANCE_CENTS = 100; // $1.00

async function bookDuffelFlight(
  offerId: string,
  passengers: BookingRequest['passengers'],
  childPassengers: BookingRequest['childPassengers'],
  requestedPriceCents?: number,
): Promise<{
  success: boolean;
  bookingRef?: string;
  totalAmount?: string;
  currency?: string;
  conditions?: DuffelConditions;
  error?: string;
  priceChanged?: boolean;
  newPriceCents?: number;
}> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return { success: false, error: 'DUFFEL_ACCESS_TOKEN not configured' };

  const headers = {
    Authorization:    `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type':   'application/json',
    Accept:           'application/json',
  };

  // Step 1: fetch live offer (get passenger slots + confirm price + conditions)
  const offerRes = await fetch(`https://api.duffel.com/air/offers/${offerId}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });

  if (!offerRes.ok) {
    const txt = await offerRes.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.errors?.[0]?.message ?? txt.slice(0, 300);
    const gone = offerRes.status === 404 || offerRes.status === 422;
    console.error('[booking-agent] Duffel offer fetch failed', offerRes.status, msg);
    return {
      success: false,
      error: gone
        ? 'Flight offer expired — please search again for fresh prices.'
        : `Offer fetch failed (${offerRes.status}): ${msg}`,
    };
  }

  const offerData = await offerRes.json() as { data?: DuffelOfferDetail };
  const offerPassengers = offerData.data?.passengers ?? [];
  const totalAmount     = offerData.data?.total_amount ?? '0';
  const totalCurrency   = offerData.data?.total_currency ?? 'USD';
  const conditions      = offerData.data?.conditions;

  if (offerPassengers.length === 0) {
    return { success: false, error: 'Offer returned no passenger slots. Please search again.' };
  }

  // ── Stale rate detection ──────────────────────────────────────────────────
  // Compare the live offer price against what was shown to the user.
  // If the price changed beyond tolerance, reject and ask them to re-confirm.
  if (requestedPriceCents !== undefined && requestedPriceCents > 0) {
    const livePriceCents = Math.round(parseFloat(totalAmount) * 100);
    const delta          = Math.abs(livePriceCents - requestedPriceCents);
    if (delta > PRICE_CHANGE_TOLERANCE_CENTS) {
      const liveFormatted = (livePriceCents / 100).toFixed(2);
      console.warn(
        `[booking-agent] Price changed: requested=${requestedPriceCents}¢ live=${livePriceCents}¢ delta=${delta}¢`
      );
      return {
        success:       false,
        priceChanged:  true,
        newPriceCents: livePriceCents,
        error:
          `The flight price has changed to $${liveFormatted} ${totalCurrency}. ` +
          `Please confirm the new price to proceed with booking.`,
      };
    }
  }

  // Map Duffel passenger slots to our passenger data
  let adultIdx = 0;
  let childIdx = 0;
  const passengerMap = offerPassengers.map((offerPax) => {
    const isChild = offerPax.type === 'child';
    if (isChild && childIdx < childPassengers.length) {
      const c = childPassengers[childIdx++];
      return {
        id:           offerPax.id,
        title:        'mr' as const,
        gender:       'm'  as const,
        given_name:   c.firstName,
        family_name:  c.lastName,
        born_on:      c.dateOfBirth,
        email:        passengers[0].email,
        phone_number: normalisePhone(passengers[0].phone),
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
        phone_number: normalisePhone(p.phone),
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
    console.error('[booking-agent] Duffel order create failed', orderRes.status, msg);
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
    conditions,
  };
}

// ─── Main booking agent ───────────────────────────────────────────────────────

export const bookingAgent = {
  async book(req: BookingRequest): Promise<AgentResult<BookingResult>> {
    const t0 = Date.now();

    const lead = req.passengers[0];
    let flightRef:            string | undefined;
    let flightError:          string | undefined;
    let hotelRef:             string | undefined;
    let hotelError:           string | undefined;
    let hotelConfirmedTotal:  number | undefined;
    let flexibilityScore:     BookingResult['flexibilityScore'];

    // ── 1. Book flight ───────────────────────────────────────────────────────
    if (req.flightOfferId) {
      if (req.flightOfferId.startsWith('amadeus_')) {
        flightError = 'Amadeus flights show reference prices only — not bookable online. Please choose a Duffel flight.';
      } else {
        try {
          const t1 = Date.now();
          const result = await bookDuffelFlight(
            req.flightOfferId,
            req.passengers,
            req.childPassengers,
            req.requestedPriceCents,
          );
          logger.flightBooking({
            api:        'duffel',
            offerId:    req.flightOfferId,
            success:    result.success,
            bookingRef: result.bookingRef,
            amount:     result.totalAmount ? parseFloat(result.totalAmount) : undefined,
            currency:   result.currency,
            error:      result.error,
            durationMs: Date.now() - t1,
          });
          if (result.success) {
            flightRef = result.bookingRef;
            // Score the flexibility from the conditions fetched during offer lookup
            if (result.conditions) {
              const fareCents = Math.round(parseFloat(result.totalAmount ?? '0') * 100);
              flexibilityScore = scoreFlexibility(result.conditions, fareCents);
            }
          } else if (result.priceChanged) {
            // Surface price change to caller — skip hotel booking too
            return {
              ok:   false,
              error: result.error,
              data: {
                success:       false,
                priceChanged:  true,
                newPriceCents: result.newPriceCents,
                currency:      'USD',
                serviceFeeCents: 0,
              } as BookingResult,
              durationMs: Date.now() - t0,
            };
          } else {
            flightError = result.error;
          }
        } catch (e) {
          flightError = `Flight booking error: ${String(e)}`;
          logger.flightBooking({
            api: 'duffel', offerId: req.flightOfferId,
            success: false, error: String(e),
          });
          console.error('[booking-agent] Duffel exception:', e);
        }
      }
    }

    // ── 2. Book hotel ─────────────────────────────────────────────────────────
    if (req.hotelRateId) {
      try {
        // The offerId in the cart can be stale (search cache is 30 min).
        // If the caller supplied hotelId + dates, re-fetch a live offerId
        // right now to guarantee the prebook token is fresh.
        let rawId = req.hotelRateId.startsWith('liteapi_')
          ? req.hotelRateId.slice('liteapi_'.length)
          : req.hotelRateId;

        if (req.hotelId && req.hotelCheckIn && req.hotelCheckOut) {
          const nationality = req.guestNationality ?? 'CA';
          let freshId = await liteApiGetFreshOfferId(
            req.hotelId,
            req.hotelCheckIn,
            req.hotelCheckOut,
            req.passengers.length,
            nationality,
          );
          // If nationality 'CA' yielded no rates, retry with 'US' — covers US hotel searches
          // where the original search used 'US' nationality but the request carries 'CA'.
          if (!freshId && nationality === 'CA') {
            console.log('[booking-agent] CA nationality returned no rates, retrying with US...');
            freshId = await liteApiGetFreshOfferId(
              req.hotelId,
              req.hotelCheckIn,
              req.hotelCheckOut,
              req.passengers.length,
              'US',
            );
          }
          if (freshId) {
            console.log('[booking-agent] fresh offerId obtained for', req.hotelId, ':', freshId);
            rawId = freshId;
          } else {
            console.warn(
              '[booking-agent] fresh rate fetch returned null for hotelId:', req.hotelId,
              '— using cached offerId:', rawId.slice(0, 20) + '…'
            );
          }
        } else {
          console.log('[booking-agent] no hotelId/dates supplied — using cached offerId:', rawId.slice(0, 20) + '…');
        }

        console.log('[booking-agent] prebook → offerID:', rawId.slice(0, 30) + (rawId.length > 30 ? '…' : ''));
        const t1 = Date.now();
        const prebook = await liteApiPrebook(rawId, req.guestNationality ?? 'CA');
        logger.hotelPrebook({
          api:            'liteapi',
          offerId:        rawId,
          success:        prebook.success,
          prebookId:      prebook.prebookId,
          confirmedTotal: prebook.confirmedTotal,
          currency:       prebook.currency,
          error:          prebook.error,
          durationMs:     Date.now() - t1,
        });

        if (!prebook.success || !prebook.prebookId) {
          hotelError = prebook.error ?? 'Hotel prebook failed';
        } else if (prebook.requiresPaymentSdk) {
          // ── Production: payment SDK flow ─────────────────────────────────────
          // LiteAPI returned secretKey + transactionId for their hosted payment widget.
          // The frontend will:
          //   1. Load https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js
          //   2. Mount the widget with secretKey + transactionId
          //   3. Customer enters card → LiteAPI charges hotel cost directly
          //   4. Frontend calls /api/complete-hotel-booking with prebookId + transactionId
          // We set requiresHotelPayment = true; booking.ts returns early (book not called yet).
          console.log('[booking-agent] production: payment SDK required, prebookId:', prebook.prebookId, '| transactionId present:', !!prebook.transactionId);
          // Don't call liteApiBook here — will be called by /api/complete-hotel-booking
          // after customer completes payment in the SDK widget.
          // NOTE: hotelRef stays undefined; returned fields signal frontend to show widget.
          return {
            ok: true,
            data: {
              success:              true,
              tripId:               req.tripId,
              flightRef,
              flightError,
              hotelName:            req.hotelName,
              requiresHotelPayment: true,
              hotelPrebookId:       prebook.prebookId,
              hotelSecretKey:       prebook.secretKey,
              hotelTransactionId:   prebook.transactionId,
              isSandboxBooking:     false,
              // Still create Stripe intent for $20 service fee (flight may already be booked)
              ...(await (async () => {
                const origin   = (req.originAirport ?? '').toUpperCase();
                const currency = origin.startsWith('Y') ? 'cad' : 'usd';
                const bookingRef = flightRef ?? `FT-${Date.now()}`;
                try {
                  const pi = await createPaymentIntent({ bookingReference: bookingRef, bookingType: flightRef ? 'flight' : 'hotel', customerEmail: lead.email, amount: 2000, currency });
                  return { clientSecret: pi.clientSecret, paymentIntentId: pi.paymentIntentId, currency, serviceFeeCents: 2000 };
                } catch (e) {
                  console.error('[booking-agent] Stripe error (non-fatal):', e);
                  return { currency, serviceFeeCents: 2000 };
                }
              })()),
            },
            durationMs: Date.now() - t0,
          };
        } else {
          // ── Sandbox: server-side ACC_CREDIT_CARD flow ─────────────────────────
          const t2 = Date.now();
          const book = await liteApiBook({
            prebookId:      prebook.prebookId,
            guestFirstName: lead.firstName,
            guestLastName:  lead.lastName,
            guestEmail:     lead.email,
          });
          logger.hotelBooking({
            api:        'liteapi',
            prebookId:  prebook.prebookId,
            success:    book.success,
            bookingId:  book.bookingId,
            hotelName:  book.hotelName,
            amount:     book.totalAmount,
            currency:   book.currency,
            error:      book.error,
            durationMs: Date.now() - t2,
          });
          if (book.success) {
            // Use bookingId from response; if LiteAPI returned 2xx but no id field,
            // fall back to a timestamp ref so the confirmation flow still completes.
            hotelRef           = book.bookingId ?? `LITEAPI-${Date.now()}`;
            hotelConfirmedTotal = prebook.confirmedTotal ?? book.totalAmount;
            if (!book.bookingId) {
              console.warn('[booking-agent] book succeeded but no bookingId — using fallback ref:', hotelRef);
            }
          } else {
            hotelError = book.error ?? 'Hotel booking failed';
          }
        }
      } catch (e) {
        hotelError = `Hotel booking error: ${String(e)}`;
        console.error('[booking-agent] LiteAPI exception:', e);
      }
    }

    // ── Bail if nothing succeeded ─────────────────────────────────────────────
    const attemptedSomething = !!(req.flightOfferId || req.hotelRateId);
    if (attemptedSomething && !flightRef && !hotelRef) {
      return {
        ok: false,
        error: flightError ?? hotelError ?? 'Both flight and hotel booking failed',
        durationMs: Date.now() - t0,
      };
    }

    // ── 3. Stripe service fee ─────────────────────────────────────────────────
    const origin   = (req.originAirport ?? '').toUpperCase();
    const currency = origin.startsWith('Y') ? 'cad' : 'usd';
    const bookingRef = flightRef ?? hotelRef ?? `FT-${Date.now()}`;

    let clientSecret:   string | undefined;
    let paymentIntentId: string | undefined;

    try {
      const pi = await createPaymentIntent({
        bookingReference: bookingRef,
        bookingType:      flightRef ? 'flight' : 'hotel',
        customerEmail:    lead.email,
        amount:           2000,
        currency,
      });
      clientSecret    = pi.clientSecret;
      paymentIntentId = pi.paymentIntentId;
      logger.stripePayment({
        bookingRef, amount: 2000, currency,
        success: true, intentId: pi.paymentIntentId,
      });
    } catch (e) {
      console.error('[booking-agent] Stripe error (non-fatal):', e);
      logger.stripePayment({ bookingRef, amount: 2000, currency, success: false, error: String(e) });
    }

    return {
      ok: true,
      data: {
        success:          true,
        tripId:           req.tripId,
        flightRef,
        hotelRef,
        hotelName:            req.hotelName,
        hotelConfirmedTotal,
        flightError,
        hotelError,
        clientSecret,
        paymentIntentId,
        currency,
        serviceFeeCents:  2000,
        flexibilityScore,
        isSandboxBooking: !!(process.env.LITEAPI_KEY?.startsWith('sand_')),
      },
      durationMs: Date.now() - t0,
    };
  },
};
