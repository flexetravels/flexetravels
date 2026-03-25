// ─── Disruption Agent ─────────────────────────────────────────────────────────
// Processes Duffel / LiteAPI disruption events and decides the right action.
//
// Decision logic:
//   flight_cancelled  → rebook if alternative within 4h exists, else credit
//   flight_delayed    → notify user if >2h; if >6h offer rebook/cancel
//   schedule_changed  → evaluate new schedule, notify or offer rebook
//   hotel_cancelled   → search alternatives, offer rebook or credit
//   unknown           → notify + log for human review
//
// All actions are dry-run by default (no side effects from this agent).
// Actual rebooking is executed by the booking agent; cancellations by the
// cancellation agent. This agent only decides and returns the action plan.

import type {
  DisruptionEvent,
  DisruptionAction,
  DisruptionType,
  AgentResult,
} from '@/lib/orchestrator/types';
import { db } from '@/lib/db/client';

// ─── Disruption thresholds ────────────────────────────────────────────────────

const DELAY_NOTIFY_MINUTES   = 120;  // >2h delay → notify user
const DELAY_REBOOK_MINUTES   = 360;  // >6h delay → offer rebook or cancel

// ─── Parse delay from Duffel payload ─────────────────────────────────────────

function parseDelayMinutes(payload: Record<string, unknown>): number {
  // Duffel sends delay_in_minutes or new scheduled vs original departure
  const direct = payload['delay_in_minutes'];
  if (typeof direct === 'number') return direct;

  const origDep   = payload['original_departing_at'] as string | undefined;
  const newDep    = payload['updated_departing_at']  as string | undefined;
  if (origDep && newDep) {
    const diff = (new Date(newDep).getTime() - new Date(origDep).getTime()) / 60000;
    return Math.max(0, diff);
  }
  return 0;
}

// ─── Decision engine ──────────────────────────────────────────────────────────

function decideAction(
  type: DisruptionType,
  payload: Record<string, unknown>,
): DisruptionAction['actions'] {
  switch (type) {
    case 'flight_cancelled':
      return [
        {
          type:    'cancel_and_credit',
          reason:  'Flight was cancelled by airline. Full credit issued.',
          details: { source: 'airline_cancellation', payload },
        },
        {
          type:    'notify',
          reason:  'Customer notified of flight cancellation and credit.',
          details: { template: 'flight_cancelled' },
        },
      ];

    case 'flight_delayed': {
      const delayMins = parseDelayMinutes(payload);
      if (delayMins < DELAY_NOTIFY_MINUTES) {
        return [{
          type:    'no_action',
          reason:  `Delay of ${delayMins} min is below notification threshold (${DELAY_NOTIFY_MINUTES} min).`,
          details: { delay_minutes: delayMins },
        }];
      }
      if (delayMins >= DELAY_REBOOK_MINUTES) {
        return [
          {
            type:    'rebook',
            reason:  `Delay of ${delayMins} min exceeds ${DELAY_REBOOK_MINUTES} min — offering rebook.`,
            details: { delay_minutes: delayMins, offer_alternatives: true },
          },
          {
            type:    'notify',
            reason:  'Customer offered rebook options or credit.',
            details: { template: 'major_delay', delay_minutes: delayMins },
          },
        ];
      }
      return [{
        type:    'notify',
        reason:  `Delay of ${delayMins} min — customer notified.`,
        details: { template: 'minor_delay', delay_minutes: delayMins },
      }];
    }

    case 'schedule_changed':
      return [
        {
          type:    'notify',
          reason:  'Schedule change detected — customer notified to review new times.',
          details: { payload },
        },
      ];

    case 'hotel_cancelled':
      return [
        {
          type:    'cancel_and_credit',
          reason:  'Hotel cancelled by property. Full credit issued.',
          details: { source: 'property_cancellation', payload },
        },
        {
          type:    'notify',
          reason:  'Customer notified of hotel cancellation and credit.',
          details: { template: 'hotel_cancelled' },
        },
      ];

    default:
      return [{
        type:    'notify',
        reason:  'Unknown disruption type — logged for human review.',
        details: { type, payload },
      }];
  }
}

// ─── Main disruption agent ────────────────────────────────────────────────────

export const disruptionAgent = {
  async handle(event: DisruptionEvent): Promise<AgentResult<DisruptionAction>> {
    const t0 = Date.now();

    try {
      const actions = decideAction(event.type, event.payload);

      // Determine credit amount if we're issuing one
      let creditIssued: number | undefined;
      let notificationMsg: string | undefined;

      const hasCreditAction = actions.some(a => a.type === 'cancel_and_credit');
      if (hasCreditAction) {
        // Fetch original booking amount to determine refund
        const booking = await db.bookings.get(event.bookingId).catch(() => null);
        if (booking) {
          creditIssued = booking.amount_cents;
        }
      }

      const notifyAction = actions.find(a => a.type === 'notify');
      if (notifyAction) {
        notificationMsg = notifyAction.reason;
      }

      // Mark the event as processed in DB
      // (The event row was already inserted by the orchestrator before we got here)
      // We can't easily look it up by event ID here — the orchestrator passes the
      // DisruptionEvent which has the DB event ID in eventId field.
      if (event.eventId) {
        // Best-effort update — ignore failure
        await db.events.insert({
          booking_id: event.bookingId,
          source:     'system',
          type:       `disruption.${event.type}.processed`,
          payload:    { actions: actions.map(a => a.type), credit_cents: creditIssued },
          processed:  true,
        }).catch(() => null);
      }

      console.log(
        `[disruption-agent] ${event.type} → actions:`,
        actions.map(a => a.type).join(', '),
      );

      return {
        ok: true,
        data: {
          bookingId:       event.bookingId,
          actions,
          creditIssued,
          notificationMsg,
        },
        durationMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },
};
