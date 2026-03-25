// ─── Orchestrator Shared Types ────────────────────────────────────────────────
// All agents consume and produce these structured types.
// No unstructured LLM strings escape the agent boundary.

import type { FlexibilityLabel, FlexibilityScore } from '@/lib/scoring/flexibility';

// ─── Re-export so callers only need one import ─────────────────────────────────
export type { FlexibilityLabel, FlexibilityScore };

// ─── Trip plan ────────────────────────────────────────────────────────────────

export interface TripIntent {
  sessionId:    string;
  origin:       string;         // IATA
  destination:  string;         // IATA or city
  departDate:   string;         // YYYY-MM-DD
  returnDate?:  string;
  adults:       number;
  children?:    number;
  childAges?:   number[];
  cabinClass:   'economy' | 'premium_economy' | 'business' | 'first';
  checkIn?:     string;
  checkOut?:    string;
  preferences?: {
    flexibility?: 'flexible' | 'any';
    maxBudget?:   number;
    minStars?:    number;
  };
}

// ─── Enriched flight (extends NormalizedFlight with scoring) ──────────────────

export interface ScoredFlight {
  id:               string;
  provider:         'duffel' | 'amadeus';
  bookingToken:     string;
  airline:          string;
  airlineLogo?:     string;
  origin:           string;
  destination:      string;
  departure:        string;
  arrival:          string;
  duration:         string;
  stops:            number;
  stopAirports:     string[];
  price:            number;
  currency:         string;
  cabinClass:       string;
  passengers:       number;
  segments:         Array<{
    origin:       string;
    destination:  string;
    departure:    string;
    arrival:      string;
    duration:     string;
    carrier:      string;
    flightNumber: string;
  }>;
  flexibility:      FlexibilityScore;
  rankScore:        number;     // 0–100, higher = better overall value
  bookable:         boolean;    // false for Amadeus reference fares
}

// ─── Booking request / result ─────────────────────────────────────────────────

export interface BookingRequest {
  sessionId:           string;
  tripId?:             string;     // DB trip ID if already created
  flightOfferId?:      string;     // Duffel offer ID
  hotelRateId?:        string;     // LiteAPI token
  hotelName?:          string;
  passengers:          PassengerDetail[];
  childPassengers:     ChildPassengerDetail[];
  originAirport?:      string;
  guestNationality?:   string;
  /** Price shown to user at search time (USD cents). Used for stale-rate detection. */
  requestedPriceCents?: number;
}

export interface PassengerDetail {
  firstName:   string;
  lastName:    string;
  dateOfBirth: string;
  email:       string;
  phone:       string;
}

export interface ChildPassengerDetail {
  firstName:   string;
  lastName:    string;
  dateOfBirth: string;
}

export interface BookingResult {
  success:          boolean;
  tripId?:          string;
  flightBookingId?: string;    // DB booking row ID
  hotelBookingId?:  string;
  flightRef?:       string;    // PNR / Duffel booking reference
  hotelRef?:        string;    // LiteAPI booking ID
  hotelName?:       string;
  flightError?:     string;
  hotelError?:      string;
  clientSecret?:    string;    // Stripe PaymentIntent client secret
  paymentIntentId?: string;
  currency:         string;
  serviceFeeCents:  number;
  flexibilityScore?: FlexibilityScore;  // of the booked flight
  /** Set when the live Duffel price differs from what was shown at search time */
  priceChanged?:    boolean;
  newPriceCents?:   number;
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

export type CancellationStrategy = 'api' | 'automation' | 'user_guided';

export interface CancellationRequest {
  bookingId:          string;         // DB booking row ID
  providerRef:        string;         // Duffel order ID / LiteAPI booking ID
  provider:           'duffel' | 'liteapi';
  reason?:            string;
  airline?:           string;         // airline slug for automation (e.g. 'air_canada')
  passengerLastName?: string;         // needed by Playwright automation
}

export interface CancellationResult {
  success:          boolean;
  strategy:         CancellationStrategy;
  refundCents?:     number;
  currency?:        string;
  creditId?:        string;           // DB credit row if partial refund created
  error?:           string;
  instructions?:    string[];         // For user_guided fallback
  automationJobId?: string;           // Queue job ID when strategy = 'automation'
}

// ─── Disruption ───────────────────────────────────────────────────────────────

export type DisruptionType =
  | 'flight_cancelled'
  | 'flight_delayed'
  | 'schedule_changed'
  | 'hotel_cancelled'
  | 'unknown';

export interface DisruptionEvent {
  eventId:    string;          // DB event row ID
  bookingId:  string;
  type:       DisruptionType;
  payload:    Record<string, unknown>;
}

export interface DisruptionAction {
  bookingId:       string;
  actions:         Array<{
    type:    'rebook' | 'cancel_and_credit' | 'notify' | 'no_action';
    reason:  string;
    details: Record<string, unknown>;
  }>;
  creditIssued?:   number;     // cents credited to user
  notificationMsg?: string;
}

// ─── Credit ───────────────────────────────────────────────────────────────────

export interface CreditSummary {
  totalAvailableCents: number;
  currency:            string;
  credits:             Array<{
    id:          string;
    amountCents: number;
    reason:      string;
    expiresAt:   string | null;
  }>;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export interface RankingWeights {
  price:       number;   // 0–1, higher = cheaper preferred
  flexibility: number;   // 0–1, higher = more flexible preferred
  duration:    number;   // 0–1, higher = shorter preferred
  stops:       number;   // 0–1, higher = fewer stops preferred
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  price:       0.40,
  flexibility: 0.30,
  duration:    0.20,
  stops:       0.10,
};

// ─── Agent result envelope ────────────────────────────────────────────────────

export interface AgentResult<T> {
  ok:        boolean;
  data?:     T;
  error?:    string;
  durationMs: number;
}
