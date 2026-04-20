// ─── Unified Search Provider Interface ────────────────────────────────────────
// All booking engines (Duffel, Amadeus, future providers) implement this contract.

export interface FlightSearchParams {
  origin: string;           // IATA airport code
  destination: string;      // IATA airport code
  departureDate: string;    // YYYY-MM-DD
  returnDate?: string;      // YYYY-MM-DD (omit for one-way)
  adults: number;
  childrenAges?: number[];  // Ages of children (2-11), each gets own seat at child fare
  infants?: number;         // Number of lap infants (under 2), no separate seat
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
  maxConnections?: number; // 0 = non-stop only, 1 = max 1 stop, undefined = no limit
}

export interface HotelSearchParams {
  destination: string;      // City name or IATA code
  checkIn: string;          // YYYY-MM-DD
  checkOut: string;         // YYYY-MM-DD
  adults: number;
  childrenAges?: number[];  // Ages of children sharing the room (0-17)
  maxPrice?: number;        // USD per night
  stars?: number;           // 1–5
}

// ─── Fare variant (one price/policy tier for the same physical flight) ────────
export interface FareVariant {
  offerId:            string;   // Duffel offer ID for this specific fare class
  price:              number;   // Total price for this variant
  currency:           string;
  flexibilityScore:   number;   // 0.00 – 1.00
  flexibilityLabel:   'Flexible' | 'Moderate' | 'Locked';
  flexibilitySummary: string;   // Human-readable conditions text
  refundable:         boolean;
  changeable:         boolean;
  fareBrandName?:     string;   // Airline's own fare tier name (e.g. "Economy Light")
  checkedBags?:       number;   // Number of checked bags included (0 = none)
}

export interface NormalizedFlight {
  id: string;
  provider: string;          // 'duffel' | 'amadeus' | etc.
  airline: string;
  airlineLogo?: string;
  origin: string;
  destination: string;
  departure: string;         // ISO8601
  arrival: string;           // ISO8601
  duration: string;          // e.g. "5h 30m"
  stops: number;
  stopAirports: string[];
  price: number;             // total in USD (cheapest variant price)
  currency: string;
  cabinClass: string;
  refundable: boolean;
  baggage?: string;
  bookingToken?: string;     // provider-specific token for booking step
  passengers?: number;       // TOTAL passengers (adults + children + infants)
  searchedAdults?: number;   // actual adult count from search params
  childrenAges?: number[];   // ages of children (2-11) searched for
  infantCount?: number;      // number of lap infants (0-1)
  fareVariants?: FareVariant[]; // Up to 3 fare tiers for the same physical flight
  childFareNote?: string;    // Set when airline doesn't price children in search API;
                             // adult fare shown — child seat confirmed at booking
  // ── Round-trip return leg ───────────────────────────────────────────────
  isRoundTrip?: boolean;
  returnOrigin?: string;
  returnDestination?: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnStops?: number;
  returnStopAirports?: string[];
  returnSegments?: Array<{
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    duration: string;
    carrier: string;
    operatingCarrier?: string;
    flightNumber: string;
  }>;
  segments: Array<{
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    duration: string;
    carrier: string;
    operatingCarrier?: string;
    flightNumber: string;
  }>;
}

export interface NormalizedHotel {
  id: string;
  provider: string;
  name: string;
  location: string;
  city: string;
  stars: number;
  pricePerNight: number;
  totalPrice: number;
  currency: string;
  image: string;
  images?: string[];           // full image URLs from /data/hotel API
  rating: number;              // 0–10
  reviewCount?: number;
  amenities: string[];         // real facility list from /data/hotel API
  distanceCenter?: string;
  cancellation?: string;
  checkIn: string;
  checkOut: string;
  bookingToken?: string;       // provider-specific token for prebook
  isSample?: boolean;          // true = indicative pricing, not live
  roomCount?: number;          // number of rooms needed for the searched party (ceil(adults/2))

  // ── Enriched LiteAPI fields ───────────────────────────────────────────────
  description?: string;        // HTML hotel description
  address?: string;            // street address
  checkinTime?: string;        // e.g. "3:00 PM"
  checkoutTime?: string;       // e.g. "12:00 PM"
  boardType?: string;          // "RO" | "BB" | "HB" | "FB" | "AI"
  boardName?: string;          // "Room Only" | "Bed & Breakfast" etc.
  maxOccupancy?: number;
  // Pricing & business data
  mspPrice?: number;           // merchant selling price (full price incl. markup)
  commissionAmount?: number;   // commission earned on this booking
  commissionCurrency?: string;
  taxesAndFees?: Array<{ included: boolean; description: string; amount: number; currency: string }>;
  // Cancellation detail
  cancelPolicies?: Array<{ cancelTime?: string; amount?: number; currency?: string; type?: string; timezone?: string }>;
  refundableTag?: string;      // "RFN" = refundable | "NRFN" = non-refundable
  // Adults count from the search that produced this hotel (used for checkout pre-fill)
  searchedAdults?: number;
  // All room types (for future room-selection UX)
  allRoomTypes?: Array<{
    offerId?:      string;
    name?:         string;
    maxOccupancy?: number;
    rates?: Array<{
      rateId?:     string;
      name?:       string;
      boardType?:  string;
      boardName?:  string;
      price?:      number;
      currency?:   string;
      commission?: number;
      refundable?: boolean;
    }>;
  }>;
}

export interface SearchResult<T> {
  provider: string;
  results: T[];
  latencyMs: number;
  error?: string;
}

// ─── Provider interface ────────────────────────────────────────────────────────
export interface SearchProvider {
  name: string;
  searchFlights(params: FlightSearchParams): Promise<NormalizedFlight[]>;
  searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]>;
}

// ─── Experiences / Points of Interest ────────────────────────────────────────
export interface ExperienceSearchParams {
  destination: string;   // City name e.g. "Cancun", "Tokyo"
  category?: string;     // 'cultural' | 'natural' | 'adventure' | 'entertainment'
  radius?: number;       // Metres from city centre (default 10000)
  limit?: number;        // Max results (default 10)
}

export interface NormalizedExperience {
  id: string;
  provider: string;        // 'opentripmap' | 'viator'
  name: string;
  category: string;        // Friendly label e.g. 'Museum', 'Nature', 'Culture'
  description?: string;
  location: string;        // Address or city
  city: string;
  image?: string;
  rating?: number;         // 0–5 scale
  price?: number;          // null = free or unknown
  currency?: string;
  duration?: string;       // e.g. "2–3 hours"
  bookable: boolean;
  bookingUrl?: string;
  coordinates?: { lat: number; lon: number };
}

export interface ExperienceProvider {
  name: string;
  searchExperiences(params: ExperienceSearchParams): Promise<NormalizedExperience[]>;
}
