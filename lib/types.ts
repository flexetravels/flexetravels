// ─── Travel data types ─────────────────────────────────────────────────────

export interface FlightSegment {
  origin:      string;   // IATA
  destination: string;
  departure:   string;   // ISO8601
  arrival:     string;
  duration:    string;   // e.g. "14h 20m"
  carrier:     string;
  flightNumber:string;
}

export interface FlightResult {
  id:           string;
  airline:      string;
  airlineLogo?: string;
  origin:       string;
  destination:  string;
  departure:    string;
  arrival:      string;
  duration:     string;
  stops:        number;
  stopAirports: string[];
  price:        number;
  currency:     string;
  cabinClass:   string;
  segments:     FlightSegment[];
  refundable:   boolean;
  baggage?:     string;
  provider?:    string;   // 'duffel' | 'amadeus' — source of the result
  bookingToken?: string;  // provider-specific booking token
  logo?:        string;   // alias for airlineLogo (Duffel compat)
}

export interface HotelResult {
  id:           string;
  name:         string;
  location:     string;
  city:         string;
  stars:        number;
  pricePerNight:number;
  totalPrice:   number;
  currency:     string;
  image:        string;
  images?:      string[];
  rating:       number;    // out of 10
  reviewCount?: number;
  amenities:    string[];
  distanceCenter?: string;
  cancellation?: string;
  checkIn:      string;
  checkOut:     string;
  provider?:    string;    // 'amadeus' | 'sample'
  isSample?:    boolean;   // true = indicative pricing
  bookingToken?: string;
}

export interface Experience {
  id:       string;
  name:     string;
  category: string;
  duration: string;
  price:    number;
  currency: string;
  image?:   string;
  rating?:  number;
  location: string;
}

// ─── Itinerary types ───────────────────────────────────────────────────────

export interface ItineraryActivity {
  time?:        string;
  title:        string;
  description?: string;
  location?:    string;
  cost?:        number;
  image?:       string;
  type:         'sightseeing' | 'food' | 'transport' | 'accommodation' | 'activity' | 'free';
}

export interface ItineraryDay {
  id:         string;
  day:        number;           // 1-based
  date?:      string;           // YYYY-MM-DD
  title:      string;
  location:   string;
  coverImage?: string;
  activities: ItineraryActivity[];
  flight?:    FlightResult;
  hotel?:     HotelResult;
  totalCost?: number;
  notes?:     string;
}

export interface Itinerary {
  id:          string;
  title:       string;
  destination: string;
  startDate?:  string;
  endDate?:    string;
  days:        ItineraryDay[];
  totalCost?:  number;
  currency:    string;
  adults:      number;
  createdAt:   string;
  updatedAt:   string;
}

// ─── Booking confirmation ──────────────────────────────────────────────────

export interface BookingConfirmation {
  reference:    string;
  type:         'flight' | 'hotel' | 'package';
  details?:     FlightResult | HotelResult;
  total:        number;   // fare + serviceFee combined
  fareAmount?:  number;   // flight/hotel cost only (from Duffel/provider)
  serviceFee?:  number;   // FlexeTravels flat fee ($20)
  currency:     string;
  bookedAt?:    string;
  status?:      'confirmed' | 'pending' | 'failed';
  email?:       string;
}

// ─── Chat-level types ──────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'data';

/** Parsed embedded card data inside an assistant message */
export type EmbeddedCard =
  | { type: 'flight'; data: FlightResult }
  | { type: 'hotel';  data: HotelResult }
  | { type: 'booking_confirmed'; data: BookingConfirmation };

// ─── UI preference ─────────────────────────────────────────────────────────

export interface TravelPreferences {
  travelGhostEnabled: boolean;  // save itinerary across sessions
  darkMode: boolean;
  currency: string;
}
