// ─── Trip Canvas — shared types ───────────────────────────────────────────────
// Used by /trip pages, /api/trip routes, and the canvas reducer.
// `state: CanvasState` is what we persist as JSONB in `trips_canvas.state`.

export const CANVAS_VERSION = 1 as const;

export interface CanvasState {
  version:    typeof CANVAS_VERSION;
  title:      string;
  travellers: {
    adults:    number;
    children:  number;
    // Optional per-child ages (in years; <2 = lap infant). When omitted, we
    // treat each child as ~8yo for pricing — accurate enough for an estimate
    // but the user should set real ages so toddlers get lap-infant pricing.
    childAges?: number[];
  };
  homeOrigin: string | null;        // IATA or city string
  legs:       CanvasLeg[];
  meta:       {
    createdFrom?:        'new' | 'chat' | 'shared';
    notes?:               string;
    interests?:           string[];      // e.g. ['beach','romance'] — vibe picker
    interestsPromptedAt?: number;        // ms-epoch — when we last asked, so we don't nag
    travelDocs?:          CanvasTravelDocs;
  };
}

export interface CanvasTravelDocs {
  passportCountry?: string;        // ISO 3166-1 alpha-2, e.g. "IN". No passport number.
  visaCountries?:    string[];     // Countries/areas where traveller already has valid entry/transit permission.
  updatedAt?:        number;
}

export interface CanvasLeg {
  id:        string;                // uuid for stable keys + drag-reorder
  city:      string;                // human-readable, e.g. "Paris"
  iata?:     string;                // arrival airport, e.g. "CDG"
  startDate: string;                // ISO date YYYY-MM-DD
  endDate:   string;                // ISO date YYYY-MM-DD
  flight?:   CanvasFlightSelection;
  hotel?:    CanvasHotelSelection;
  notes?:    string;
  // Things-to-do plan from /api/canvas/itinerary, fetched when the user
  // opens the panel. Cached on the canvas so a refresh doesn't re-call
  // Gemini. Cleared when the city changes.
  itinerary?: CanvasItinerary;
}

export interface CanvasItineraryItem {
  name:     string;
  why:      string;
  category: 'attraction' | 'food' | 'museum' | 'outdoor' | 'shopping' | 'nightlife' | 'experience';
  timeOfDay?:       'morning' | 'afternoon' | 'evening' | 'night';
  durationMinutes?: number;
  // Google Places enrichment — present when the place resolved
  placeId?:    string;
  rating?:     number;
  ratingCount?: number;
  photo?:      string;
  lat?:        number;
  lon?:        number;
  address?:    string;
  hours?:      string[];
  priceLevel?: 0 | 1 | 2 | 3 | 4;
  websiteUrl?: string;
  mapsUrl?:    string;
}

export interface CanvasItinerary {
  // The city the itinerary was generated for. Used to detect when the leg's
  // city has changed and the itinerary needs to be re-fetched.
  city:        string;
  days:        Array<{ day: number; items: CanvasItineraryItem[] }>;
  generatedAt: number;
  source:      'gemini-grounded' | 'gemini' | 'fallback';
}

export interface CanvasFlightSelection {
  offerId:        string;           // duffel offer id (the booking token)
  origin:         string;           // origin IATA
  destination:    string;           // destination IATA
  airline:        string;           // human name
  flightNumber:   string;
  departureTime:  string;           // ISO datetime
  arrivalTime:    string;           // ISO datetime
  duration:       string;           // human-readable, e.g. "7h 35m"
  stops:          number;
  stopAirports?:  string[];
  cabinClass:     string;
  priceCents:     number;
  currency:       string;
  flexibility?:   'Flexible' | 'Moderate' | 'Locked';
  flexibilitySummary?: string;
  refundable?:    boolean;
  baggage?:       string;
  segments?:      CanvasFlightSegment[];
  legs?:          CanvasFlightLeg[];
  returnSegments?: CanvasFlightSegment[];
  returnDeparture?: string;
  returnArrival?:   string;
  returnDuration?:  string;
  returnStops?:     number;
  returnStopAirports?: string[];
  // Captured at search time so the UI can flag "priced for 2 adults — re-search
  // for the new traveller mix" when state.travellers changes after the pick.
  pricedFor?:     { adults: number; children: number; childAges?: number[] };
}

export interface CanvasFlightSegment {
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  duration: string;
  carrier: string;
  operatingCarrier?: string;
  flightNumber: string;
}

export interface CanvasFlightLeg {
  origin: string;
  destination: string;
  departure?: string;
  arrival?: string;
  duration?: string;
  stops?: number;
  stopAirports?: string[];
  segments: CanvasFlightSegment[];
}

export interface CanvasHotelSelection {
  rateId:         string;           // liteapi rate id
  hotelId:        string;
  name:           string;
  city:           string;
  starRating?:    number;
  reviewScore?:   number;
  perNightCents:  number;
  totalCents:     number;
  currency:       string;
  cancellationPolicy?: string;
  image?:         string;           // main thumbnail URL (carried from picker into the docked card)
  pricedFor?:     { adults: number; children: number; childAges?: number[] };
}

// ─── DB row shape ─────────────────────────────────────────────────────────────

export interface TripCanvasRow {
  id:           string;
  session_id:   string;
  user_id:      string | null;
  title:        string;
  origin_city:  string | null;
  state:        CanvasState;
  status:       'planning' | 'booked' | 'archived';
  created_at:   string;
  updated_at:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function emptyCanvas(opts?: Partial<CanvasState>): CanvasState {
  return {
    version:    CANVAS_VERSION,
    title:      opts?.title ?? 'Untitled trip',
    travellers: opts?.travellers ?? { adults: 1, children: 0 },
    homeOrigin: opts?.homeOrigin ?? null,
    legs:       opts?.legs ?? [],
    meta:       opts?.meta ?? { createdFrom: 'new' },
  };
}
