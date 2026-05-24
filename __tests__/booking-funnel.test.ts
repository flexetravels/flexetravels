import { describe, expect, it } from 'vitest';
import { createBookingCart, flightPriceOrCurrencyChanged, parseTravelerAges } from '@/lib/booking-funnel';
import { calculateServiceFeeTax, SERVICE_FEE_CENTS } from '@/lib/tax';
import { enrichFareConditions } from '@/lib/fare-conditions';
import { publicSearchWarnings } from '@/lib/public-errors';
import type { FlightResult } from '@/lib/types';

const selectedFlight: FlightResult = {
  id: 'off_selected_exact_fare_123',
  bookingToken: 'off_selected_exact_fare_123',
  airline: 'Air Canada',
  origin: 'YVR',
  destination: 'YYZ',
  departure: '2026-06-20T09:00:00',
  arrival: '2026-06-20T16:30:00',
  duration: '4h 30m',
  stops: 0,
  stopAirports: [],
  price: 512.34,
  currency: 'USD',
  cabinClass: 'economy',
  segments: [],
  refundable: false,
  baggage: '1 checked bag',
  passengers: 2,
};

describe('parseTravelerAges', () => {
  it('keeps valid child ages and drops invalid input', () => {
    expect(parseTravelerAges('1, 5, 17, nope, 22, -1')).toEqual([1, 5, 17]);
  });
});

describe('createBookingCart', () => {
  it('preserves the exact selected Duffel offer and displayed fare in the checkout cart', () => {
    const cart = createBookingCart({
      flight: selectedFlight,
      hotel: null,
      adults: 1,
      childAges: [5],
      sessionId: 'web_test',
      savedAt: 123,
    });

    expect(cart.flight?.id).toBe('off_selected_exact_fare_123');
    expect(cart.flight?.price).toBe(512.34);
    expect(cart.flight?.currency).toBe('USD');
    expect(cart.adults).toBe(2);
    expect(cart.children).toEqual({ count: 1, ages: [5] });
    expect(cart.selectionSnapshot).toMatchObject({
      offerId: 'off_selected_exact_fare_123',
      bookingToken: 'off_selected_exact_fare_123',
      airline: 'Air Canada',
      route: 'YVR-YYZ',
      price: 512.34,
      currency: 'USD',
      baggage: '1 checked bag',
      refundable: false,
    });
  });
});

describe('flightPriceOrCurrencyChanged', () => {
  it('does not flag identical verified price and currency', () => {
    expect(flightPriceOrCurrencyChanged({
      selectedPriceCents: 51234,
      verifiedPriceCents: 51234,
      selectedCurrency: 'USD',
      verifiedCurrency: 'usd',
    })).toBe(false);
  });

  it('flags any fare change before payment setup', () => {
    expect(flightPriceOrCurrencyChanged({
      selectedPriceCents: 51234,
      verifiedPriceCents: 52234,
      selectedCurrency: 'USD',
      verifiedCurrency: 'USD',
    })).toBe(true);
  });
});

describe('calculateServiceFeeTax', () => {
  it('charges GST on the service fee for British Columbia customers', () => {
    expect(calculateServiceFeeTax({
      amountCents: SERVICE_FEE_CENTS,
      country: 'CA',
      region: 'BC',
    })).toMatchObject({
      taxCents: 100,
      taxRateBps: 500,
      taxLabel: 'GST 5%',
      jurisdiction: 'BC, Canada',
    });
  });

  it('charges HST on the service fee for Ontario customers', () => {
    expect(calculateServiceFeeTax({
      amountCents: SERVICE_FEE_CENTS,
      country: 'CA',
      region: 'ON',
    })).toMatchObject({
      taxCents: 260,
      taxRateBps: 1300,
      taxLabel: 'HST 13%',
      jurisdiction: 'ON, Canada',
    });
  });

  it('does not guess U.S. sales tax without a registered state tax rule', () => {
    expect(calculateServiceFeeTax({
      amountCents: SERVICE_FEE_CENTS,
      country: 'US',
      region: 'WA',
    })).toMatchObject({
      taxCents: 0,
      taxRateBps: 0,
      jurisdiction: 'WA, United States',
    });
  });
});

describe('enrichFareConditions', () => {
  it('labels higher fare-family pricing without exposing provider contradictions to customers', () => {
    const terms = enrichFareConditions({
      airline: 'Cathay Pacific',
      origin: 'BLR',
      destination: 'YVR',
      cabinClass: 'premium_economy',
      fareBrandName: 'Premium Economy Flex',
      refundable: false,
      changeable: false,
      flexibilitySummary: 'Flexibility details unavailable — assume non-refundable.',
      checkedBags: 2,
      price: 1979,
      currency: 'USD',
      baselinePrice: 1201,
      baselineCheckedBags: 2,
    });

    expect(terms.confidenceLabel).toBe('Based on airline fare-family guidance');
    expect(terms.source).toBe('Airline fare-family guidance');
    expect(terms.summary).toContain('$778');
    expect(terms.bestFor).toBe('Travellers whose dates may change');
    expect(terms.changeTerms.uiLabel).toBe('Based on airline fare-family guidance');
    expect(terms.refundTerms.simpleSummary).toContain('Cancellation fees and refund value depend');
    expect(terms.checkoutDisclaimer).toContain('final airline ticket rules');
    expect(terms.caveats.join(' ')).not.toContain('Duffel returned');
    expect(terms.caveats.join(' ')).not.toContain('structured change/refund rules were not visible');
  });

  it('uses airline-specific Premium Economy Flex guidance when available', () => {
    const terms = enrichFareConditions({
      airline: 'Lufthansa',
      origin: 'BLR',
      destination: 'YVR',
      cabinClass: 'premium_economy',
      fareBrandName: 'Premium Economy Flex',
      refundable: true,
      changeable: true,
      flexibilitySummary: 'Free cancellation · Free changes',
      checkedBags: 2,
      price: 2352,
      currency: 'USD',
      baselinePrice: 2137,
      baselineCheckedBags: 2,
    });

    expect(terms.customerLabel).toBe('Lufthansa Premium Economy Flex fare-family option');
    expect(terms.possibleBenefits.map(item => item.value).join(' ')).toContain('Free rebooking guidance');
    expect(terms.changeTerms.uiLabel).toBe('Confirmed');
    expect(terms.refundTerms.uiLabel).toBe('Confirmed');
  });
});

describe('publicSearchWarnings', () => {
  it('sanitizes raw hotel provider failures before they can reach the customer UI', () => {
    const warnings = publicSearchWarnings(
      'hotel',
      ['liteapi: Error: No hotels found for Maple ridge, US in LiteAPI (tried all fallbacks)'],
      { hasResults: false },
    );

    expect(warnings).toEqual(['No live hotel inventory matched this search. Try nearby areas or different dates.']);
    expect(warnings.join(' ')).not.toMatch(/liteapi|fallback|Maple ridge|US/i);
  });

  it('uses a generic partial-results warning when verified results are still available', () => {
    const warnings = publicSearchWarnings(
      'hotel',
      ['liteapi: upstream timeout with provider trace abc123'],
      { hasResults: true },
    );

    expect(warnings).toEqual(['Some live hotel sources did not respond. We are showing the best available options we could verify.']);
    expect(warnings.join(' ')).not.toMatch(/liteapi|abc123|provider trace/i);
  });
});
