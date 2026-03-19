// ─── Unified Search Provider Interface ────────────────────────────────────────
// All booking engines (Duffel, Amadeus, future providers) implement this contract.

export interface FlightSearchParams {
  origin: string;           // IATA airport code
  destination: string;      // IATA airport code
  departureDate: string;    // YYYY-MM-DD
  returnDate?: string;      // YYYY-MM-DD (omit for one-way)
  adults: number;
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
}

export interface HotelSearchParams {
  destination: string;      // City name or IATA code
  checkIn: string;          // YYYY-MM-DD
  checkOut: string;         // YYYY-MM-DD
  adults: number;
  maxPrice?: number;        // USD per night
  stars?: number;           // 1–5
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
  price: number;             // total in USD
  currency: string;
  cabinClass: string;
  refundable: boolean;
  baggage?: string;
  bookingToken?: string;     // provider-specific token for booking step
  segments: Array<{
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    duration: string;
    carrier: string;
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
  images?: string[];
  rating: number;            // 0–10
  reviewCount?: number;
  amenities: string[];
  distanceCenter?: string;
  cancellation?: string;
  checkIn: string;
  checkOut: string;
  bookingToken?: string;     // provider-specific token
  isSample?: boolean;        // true = indicative pricing, not live
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
