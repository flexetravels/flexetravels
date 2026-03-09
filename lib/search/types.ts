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
