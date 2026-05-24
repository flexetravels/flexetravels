import type { FlightResult, HotelResult } from '@/lib/types';

export interface BookingCartData {
  flight: FlightResult | null;
  hotel: HotelResult | null;
  adults: number;
  children: { count: number; ages: number[] } | null;
  savedAt: number;
  sessionId: string;
  selectionSnapshot?: {
    offerId: string;
    bookingToken?: string;
    airline: string;
    route: string;
    departure: string;
    returnDeparture?: string;
    cabinClass: string;
    price: number;
    currency: string;
    baggage?: string;
    refundable: boolean;
    fareBrandName?: string;
    fareTermsSummary?: string;
    fareTermsCaveats?: string[];
    fareTermsConfidence?: string;
    fareTermsDetails?: FlightResult['fareTermsDetails'];
  };
}

export function parseTravelerAges(value: string): number[] {
  return value
    .split(',')
    .map(v => Number.parseInt(v.trim(), 10))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 17);
}

export function createBookingCart({
  flight,
  hotel,
  adults,
  childAges,
  sessionId,
  savedAt = Date.now(),
}: {
  flight: FlightResult | null;
  hotel: HotelResult | null;
  adults: number;
  childAges: number[];
  sessionId: string;
  savedAt?: number;
}): BookingCartData {
  const resolvedAdults = flight?.searchedAdults ?? flight?.passengers ?? hotel?.searchedAdults ?? adults;

  return {
    flight,
    hotel,
    adults: resolvedAdults,
    children: childAges.length > 0 ? { count: childAges.length, ages: childAges } : null,
    savedAt,
    sessionId,
    selectionSnapshot: flight ? {
      offerId: flight.id,
      bookingToken: flight.bookingToken,
      airline: flight.airline,
      route: `${flight.origin}-${flight.destination}`,
      departure: flight.departure,
      returnDeparture: flight.returnDeparture,
      cabinClass: flight.cabinClass,
      price: flight.price,
      currency: flight.currency,
      baggage: flight.baggage,
      refundable: flight.refundable,
      fareBrandName: flight.fareBrandName,
      fareTermsSummary: flight.fareTermsSummary,
      fareTermsCaveats: flight.fareTermsCaveats,
      fareTermsConfidence: flight.fareTermsConfidence,
      fareTermsDetails: flight.fareTermsDetails,
    } : undefined,
  };
}

export function flightPriceOrCurrencyChanged({
  selectedPriceCents,
  verifiedPriceCents,
  selectedCurrency,
  verifiedCurrency,
}: {
  selectedPriceCents: number;
  verifiedPriceCents: number;
  selectedCurrency: string;
  verifiedCurrency: string;
}): boolean {
  return (
    selectedPriceCents !== verifiedPriceCents ||
    selectedCurrency.toUpperCase() !== verifiedCurrency.toUpperCase()
  );
}
