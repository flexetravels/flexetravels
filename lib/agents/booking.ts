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
import { liteApiPrebook, liteApiBook } from '@/lib/search/liteapi';
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

async function bookDuffelFlight(
  offerId: string,
  passengers: BookingRequest['passengers'],
  childPassengers: BookingRequest['childPassengers'],
): Promise<{
  success: boolean;
  bookingRef?: string;
  totalAmount?: string;
  currency?: string;
  conditions?: DuffelConditions;
  error?: string;
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
    let flightRef:      string | undefined;
    let flightError:    string | undefined;
    let hotelRef:       string | undefined;
    let hotelError:     string | undefined;
    let flexibilityScore: BookingResult['flexibilityScore'];

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
        const rawId = req.hotelRateId.startsWith('liteapi_')
          ? req.hotelRateId.slice('liteapi_'.length)
          : req.hotelRateId;

        const t1 = Date.now();
        const prebook = await liteApiPrebook(rawId, req.guestNationality ?? 'US');
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
        } else {
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
            hotelRef = book.bookingId;
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
        hotelName:        req.hotelName,
        flightError,
        hotelError,
        clientSecret,
        paymentIntentId,
        currency,
        serviceFeeCents:  2000,
        flexibilityScore,
      },
      durationMs: Date.now() - t0,
    };
  },
};
