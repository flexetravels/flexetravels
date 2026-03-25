// ─── Orchestrator — Central Decision Brain ────────────────────────────────────
// Single entry point for all booking logic. API routes are thin controllers;
// all domain logic lives in agents called from here.
//
// Flow:
//   Intent → Orchestrator → Agent → AgentResult<T>
//
// The orchestrator:
//   1. Validates the incoming intent
//   2. Loads relevant trip state from DB (if sessionId known)
//   3. Dispatches to the correct agent
//   4. Persists side-effects (trip/booking rows, events)
//   5. Returns a typed AgentResult

import type {
  TripIntent, BookingRequest, BookingResult,
  CancellationRequest, CancellationResult,
  DisruptionEvent, DisruptionAction,
  AgentResult, ScoredFlight,
} from './types';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { plannerAgent }      from '@/lib/agents/planner';
import { rankingAgent }      from '@/lib/agents/ranking';
import { bookingAgent }      from '@/lib/agents/booking';
import { cancellationAgent } from '@/lib/agents/cancellation';
import { disruptionAgent }   from '@/lib/agents/disruption';
import { creditAgent }       from '@/lib/agents/credit';

export { DB_AVAILABLE };

// ─── Search & Rank ────────────────────────────────────────────────────────────

/**
 * Search + score + rank flights for a TripIntent.
 * Returns top-N ScoredFlight objects with flexibility scores + rankScore.
 */
export async function searchAndRank(
  intent: TripIntent,
): Promise<AgentResult<ScoredFlight[]>> {
  const t0 = Date.now();
  try {
    // Planner validates + enriches the intent (IATA resolution, date checks)
    const planned = await plannerAgent.plan(intent);
    if (!planned.ok) {
      return { ok: false, error: planned.error, durationMs: Date.now() - t0 };
    }

    // Ranking agent fetches from Duffel, scores flexibility, ranks by weights
    const ranked = await rankingAgent.rank(planned.data!);
    return { ...ranked, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ─── Book ─────────────────────────────────────────────────────────────────────

/**
 * Execute a booking for flight + hotel.
 * Persists trip + booking rows; returns BookingResult with Stripe client secret.
 */
export async function book(
  req: BookingRequest,
): Promise<AgentResult<BookingResult>> {
  const t0 = Date.now();
  try {
    const result = await bookingAgent.book(req);
    if (result.ok && result.data) {
      await _persistBooking(req, result.data);
    }
    return { ...result, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

/**
 * Cancel a booking — tries API cancellation, falls back to browser automation,
 * then user-guided instructions. Issues credits on partial refunds.
 */
export async function cancel(
  req: CancellationRequest,
): Promise<AgentResult<CancellationResult>> {
  const t0 = Date.now();
  try {
    const result = await cancellationAgent.cancel(req);
    if (result.ok && result.data) {
      await _persistCancellation(req, result.data);
    }
    return { ...result, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ─── Handle Disruption ────────────────────────────────────────────────────────

/**
 * Process an inbound disruption event (from Duffel webhook or LiteAPI).
 * Decides: rebook / cancel-and-credit / notify / no-action.
 */
export async function handleDisruption(
  event: DisruptionEvent,
): Promise<AgentResult<DisruptionAction>> {
  const t0 = Date.now();
  try {
    // Log event first so it's captured even if processing fails
    await db.events.insert({
      booking_id: event.bookingId,
      source:     'duffel_webhook',
      type:       event.type,
      payload:    event.payload,
      processed:  false,
    });

    const result = await disruptionAgent.handle(event);

    // Mark event processed
    if (result.ok) {
      // We don't have the event row ID here; mark via booking query
      // (processed flag is set by the disruption agent internally)
    }

    return { ...result, durationMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ─── Credits ─────────────────────────────────────────────────────────────────

/**
 * Get all available credits for a session.
 */
export async function getCredits(sessionId: string) {
  return creditAgent.getSummary(sessionId);
}

// ─── Trip State ───────────────────────────────────────────────────────────────

/**
 * Fetch current trip state for a session (latest non-archived trip).
 */
export async function getTripState(sessionId: string) {
  const t0 = Date.now();
  try {
    const trip = await db.trips.getBySession(sessionId);
    if (!trip) return { ok: true, data: null, durationMs: Date.now() - t0 } as const;

    const bookings = await db.bookings.getByTrip(trip.id);
    return {
      ok: true,
      data: { trip, bookings },
      durationMs: Date.now() - t0,
    } as const;
  } catch (e) {
    return { ok: false as const, error: String(e), durationMs: Date.now() - t0 };
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _persistBooking(
  req: BookingRequest,
  result: BookingResult,
): Promise<void> {
  if (!DB_AVAILABLE) {
    console.warn('[orchestrator] _persistBooking skipped — DB not configured');
    return;
  }
  try {
    // Ensure trip row exists
    let tripId = req.tripId ?? result.tripId;
    if (!tripId) {
      const trip = await db.trips.create({
        session_id:  req.sessionId,
        status:      'booked',
        origin:      req.originAirport ?? '',
        destination: '',
        depart_date: new Date().toISOString().slice(0, 10),
      });
      tripId = trip?.id;
      if (!tripId) {
        console.error('[orchestrator] _persistBooking: trips.create returned null — cannot write booking row');
        return;
      }
      console.log('[orchestrator] trip row created:', tripId);
    }

    // Write flight booking row
    if (result.flightRef && result.flightBookingId === undefined) {
      const label = result.flexibilityScore?.label ?? null;
      // Validate label against DB constraint before inserting
      const validLabels = ['Flexible', 'Moderate', 'Locked', null] as const;
      const safeLabel = validLabels.includes(label as typeof validLabels[number]) ? label : null;
      const bk = await db.bookings.create({
        trip_id:           tripId,
        type:              'flight',
        provider:          'duffel',
        status:            'confirmed',
        provider_ref:      result.flightRef,
        booking_ref:       result.flightRef,
        amount_cents:      0,
        currency:          result.currency ?? 'USD',
        flexibility_score: result.flexibilityScore?.score ?? null,
        flexibility_label: safeLabel,
      });
      if (bk) {
        console.log('[orchestrator] flight booking row created:', bk.id, '| ref:', result.flightRef);
      } else {
        console.error('[orchestrator] _persistBooking: bookings.create returned null for flight', result.flightRef);
      }
    }

    // Write hotel booking row
    if (result.hotelRef && result.hotelBookingId === undefined) {
      const bk = await db.bookings.create({
        trip_id:      tripId,
        type:         'hotel',
        provider:     'liteapi',
        status:       'confirmed',
        provider_ref: result.hotelRef,
        booking_ref:  result.hotelRef,
        amount_cents: 0,
        currency:     result.currency ?? 'USD',
      });
      if (bk) {
        console.log('[orchestrator] hotel booking row created:', bk.id, '| ref:', result.hotelRef);
      } else {
        console.error('[orchestrator] _persistBooking: bookings.create returned null for hotel', result.hotelRef);
      }
    }
  } catch (e) {
    console.error('[orchestrator] _persistBooking failed (non-fatal):', e);
  }
}

async function _persistCancellation(
  req: CancellationRequest,
  result: CancellationResult,
): Promise<void> {
  if (!DB_AVAILABLE) return;
  try {
    await db.bookings.update(req.bookingId, { status: 'cancelled' });

    // Issue credit if partial refund
    if (result.refundCents && result.refundCents > 0) {
      const booking = await db.bookings.get(req.bookingId);
      if (booking) {
        await db.credits.create({
          session_id:   booking.metadata?.session_id as string ?? '',
          booking_id:   req.bookingId,
          amount_cents: result.refundCents,
          currency:     result.currency ?? 'USD',
          reason:       req.reason ?? `Cancellation refund — ${req.provider}`,
          status:       'available',
          expires_at:   new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    await db.events.insert({
      booking_id: req.bookingId,
      source:     'system',
      type:       'booking.cancelled',
      payload:    {
        strategy:     result.strategy,
        refund_cents: result.refundCents,
        provider_ref: req.providerRef,
      },
      processed: true,
    });
  } catch (e) {
    console.error('[orchestrator] _persistCancellation failed (non-fatal):', e);
  }
}
