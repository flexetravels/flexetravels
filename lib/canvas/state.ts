// ─── Trip Canvas — reducer & operations ───────────────────────────────────────
// Pure functions that take a CanvasState and an op, return a new state.
// Used both client-side (optimistic UI) and server-side (when AI commands
// arrive via /api/trip/[id]/command, we replay the ops on the persisted state).

import {
  type CanvasState,
  type CanvasLeg,
  type CanvasFlightSelection,
  type CanvasHotelSelection,
  type CanvasItinerary,
} from './types';

// Stable-ish UUID without adding a dep — good enough for client-side leg IDs.
export function makeLegId(): string {
  return 'leg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ─── Op types ─────────────────────────────────────────────────────────────────

export type CanvasOp =
  | { type: 'set_title';        title: string }
  | { type: 'set_travellers';   adults: number; children: number; childAges?: number[] }
  | { type: 'set_travel_docs';  passportCountry?: string; visaCountries?: string[] }
  | { type: 'set_home_origin';  origin: string | null }
  | { type: 'add_leg';          leg: Omit<CanvasLeg, 'id'> & { id?: string }; index?: number }
  | { type: 'remove_leg';       legId: string }
  | { type: 'reorder_legs';     legIds: string[] }
  | { type: 'update_leg';       legId: string; patch: Partial<Omit<CanvasLeg, 'id'>> }
  | { type: 'set_flight';       legId: string; flight: CanvasFlightSelection }
  | { type: 'clear_flight';     legId: string }
  | { type: 'set_hotel';        legId: string; hotel: CanvasHotelSelection }
  | { type: 'clear_hotel';      legId: string }
  | { type: 'set_interests';    interests: string[] }
  | { type: 'mark_interests_prompted' }
  | { type: 'set_itinerary';    legId: string; itinerary: CanvasItinerary }
  | { type: 'clear_itinerary';  legId: string };

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function applyOp(state: CanvasState, op: CanvasOp): CanvasState {
  switch (op.type) {
    case 'set_title':
      return { ...state, title: op.title };

    case 'set_travellers': {
      const adults   = clamp(op.adults, 1, 9);
      const children = clamp(op.children, 0, 9);
      // Resize/normalize childAges to match the new children count. Age 0–17;
      // <2 will be priced as a lap infant downstream.
      let childAges: number[] | undefined;
      if (children > 0) {
        const incoming = op.childAges ?? state.travellers.childAges ?? [];
        childAges = Array.from({ length: children }, (_, i) => {
          const a = incoming[i];
          return Number.isFinite(a) ? Math.max(0, Math.min(17, Math.floor(a as number))) : 8;
        });
      }
      return {
        ...state,
        travellers: childAges ? { adults, children, childAges } : { adults, children },
      };
    }

    case 'set_travel_docs': {
      const passportCountry = op.passportCountry?.trim().toUpperCase();
      const visaCountries = Array.from(new Set((op.visaCountries ?? [])
        .map(c => c.trim().toUpperCase())
        .filter(c => /^[A-Z]{2}$/.test(c) || c === 'SCHENGEN' || c === 'EU')))
        .slice(0, 30);
      return {
        ...state,
        meta: {
          ...state.meta,
          travelDocs: {
            passportCountry: passportCountry && /^[A-Z]{2}$/.test(passportCountry) ? passportCountry : undefined,
            visaCountries,
            updatedAt: Date.now(),
          },
        },
      };
    }

    case 'set_home_origin':
      return { ...state, homeOrigin: op.origin };

    case 'add_leg': {
      const newLeg: CanvasLeg = { id: op.leg.id ?? makeLegId(), ...op.leg };
      const legs = [...state.legs];
      if (typeof op.index === 'number' && op.index >= 0 && op.index <= legs.length) {
        legs.splice(op.index, 0, newLeg);
      } else {
        legs.push(newLeg);
      }
      return { ...state, legs };
    }

    case 'remove_leg':
      return { ...state, legs: state.legs.filter(l => l.id !== op.legId) };

    case 'reorder_legs': {
      const map = new Map(state.legs.map(l => [l.id, l]));
      const reordered = op.legIds.map(id => map.get(id)).filter((l): l is CanvasLeg => Boolean(l));

      // Empty trip / nothing to reorder — pass through
      if (reordered.length === 0 || state.legs.length === 0) {
        return { ...state, legs: reordered };
      }

      // Slide dates so the trip stays continuous after reorder. Trip start is
      // anchored to the ORIGINAL first leg's startDate (so the trip occupies
      // the same calendar window — only the city order changes within it).
      // Each leg keeps its duration; the next leg starts where the previous
      // ends. Any leg whose dates actually change loses its picked flight +
      // hotel — those offers were priced for the old dates and won't book.
      const originalTripStart = state.legs[0].startDate;
      let cursor = originalTripStart;
      const slid: CanvasLeg[] = reordered.map(leg => {
        const days = nightCountDays(leg.startDate, leg.endDate);
        const newStart = cursor;
        const newEnd   = addDaysYmd(cursor, days);
        cursor = newEnd;
        if (newStart === leg.startDate && newEnd === leg.endDate) {
          return leg;             // position unchanged — keep flight + hotel
        }
        // Dates moved — drop the priced flight/hotel for this leg since their
        // departure times / occupancy windows no longer match.
        const { flight: _f, hotel: _h, ...rest } = leg;
        void _f; void _h;
        return { ...rest, startDate: newStart, endDate: newEnd };
      });

      return { ...state, legs: slid };
    }

    case 'update_leg':
      return {
        ...state,
        legs: state.legs.map(l => (l.id === op.legId ? { ...l, ...op.patch } : l)),
      };

    case 'set_flight':
      return {
        ...state,
        legs: state.legs.map(l => (l.id === op.legId ? { ...l, flight: op.flight } : l)),
      };

    case 'clear_flight':
      return {
        ...state,
        legs: state.legs.map(l => {
          if (l.id !== op.legId) return l;
          const { flight: _flight, ...rest } = l;
          void _flight;
          return rest as CanvasLeg;
        }),
      };

    case 'set_hotel':
      return {
        ...state,
        legs: state.legs.map(l => (l.id === op.legId ? { ...l, hotel: op.hotel } : l)),
      };

    case 'clear_hotel':
      return {
        ...state,
        legs: state.legs.map(l => {
          if (l.id !== op.legId) return l;
          const { hotel: _hotel, ...rest } = l;
          void _hotel;
          return rest as CanvasLeg;
        }),
      };

    case 'set_interests': {
      const cleaned = Array.from(new Set(op.interests.map(s => s.trim()).filter(Boolean))).slice(0, 6);
      return { ...state, meta: { ...state.meta, interests: cleaned, interestsPromptedAt: Date.now() } };
    }

    case 'mark_interests_prompted':
      return { ...state, meta: { ...state.meta, interestsPromptedAt: Date.now() } };

    case 'set_itinerary':
      return {
        ...state,
        legs: state.legs.map(l => (l.id === op.legId ? { ...l, itinerary: op.itinerary } : l)),
      };

    case 'clear_itinerary':
      return {
        ...state,
        legs: state.legs.map(l => {
          if (l.id !== op.legId) return l;
          const { itinerary: _it, ...rest } = l;
          void _it;
          return rest as CanvasLeg;
        }),
      };
  }
}

export function applyOps(state: CanvasState, ops: CanvasOp[]): CanvasState {
  return ops.reduce(applyOp, state);
}

// ─── Derived totals ──────────────────────────────────────────────────────────

export interface CanvasTotals {
  currency:           string;        // USD by default — display currency lives in CurrencyContext
  flightCents:        number;
  hotelCents:         number;
  serviceFeeCents:    2000;          // always $20 USD
  totalCents:         number;        // flight + hotel + service fee, all in USD
  otaEstimateCents:   number;        // +6% commission heuristic on flight + hotel
  savingsVsOtaCents:  number;        // otaEstimate - (flight + hotel + serviceFee)
}

const OTA_COMMISSION_FACTOR = 0.06;  // industry-standard hotel commission is 10–18%, blended with flight ~3% gives ~6% rough heuristic

export function computeTotals(state: CanvasState): CanvasTotals {
  let flightCents = 0;
  let hotelCents  = 0;

  for (const leg of state.legs) {
    if (leg.flight) flightCents += leg.flight.priceCents;
    if (leg.hotel)  hotelCents  += leg.hotel.totalCents;
  }

  const serviceFeeCents = 2000 as const;
  const totalCents      = flightCents + hotelCents + serviceFeeCents;
  const otaEstimateCents = Math.round((flightCents + hotelCents) * (1 + OTA_COMMISSION_FACTOR));
  const savingsVsOtaCents = Math.max(0, otaEstimateCents - (flightCents + hotelCents + serviceFeeCents));

  return {
    currency: 'USD',
    flightCents,
    hotelCents,
    serviceFeeCents,
    totalCents,
    otaEstimateCents,
    savingsVsOtaCents,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ─── Date helpers (used by reorder_legs to slide dates) ───────────────────

// Number of nights between two YYYY-MM-DD strings. Returns 0 if either is
// missing or end is before start. We use noon (T12:00:00) instead of midnight
// to avoid daylight-saving and timezone-near-midnight off-by-one bugs.
function nightCountDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(start + 'T12:00:00').getTime();
  const b = new Date(end   + 'T12:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Add N days to a YYYY-MM-DD string and return another YYYY-MM-DD string.
// Same noon-anchoring trick as above.
function addDaysYmd(ymd: string, days: number): string {
  if (!ymd) return ymd;
  const d = new Date(ymd + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + days);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}
