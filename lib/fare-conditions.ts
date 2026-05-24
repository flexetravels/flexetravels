import { formatPrice } from '@/lib/utils';

const CHECKOUT_DISCLAIMER = 'Exact fees, refund amounts, no-show penalties, and eligibility are governed by the final airline ticket rules.';

export interface FareTermsInput {
  airline: string;
  origin: string;
  destination: string;
  cabinClass: string;
  fareBrandName?: string;
  refundable?: boolean;
  changeable?: boolean;
  flexibilitySummary?: string;
  checkedBags?: number;
  price: number;
  currency: string;
  baselinePrice?: number;
  baselineCheckedBags?: number;
}

export interface CustomerFareTerms {
  displayName: string;
  customerLabel: string;
  bestFor: string;
  summary: string;
  knownInclusions: FareConditionLine[];
  changeTerms: FareConditionBlock;
  refundTerms: FareConditionBlock;
  possibleBenefits: FareConditionLine[];
  caveats: string[];
  confidenceScore: number;
  confidenceLabel: FareConditionUiLabel;
  source: 'Duffel conditions' | 'Airline fare-family guidance' | 'Ticket rules apply';
  checkoutDisclaimer: string;
}

export type FareConditionSource =
  | 'duffel'
  | 'airline_fare_family_guidance'
  | 'ticket_rules_apply'
  | 'live_quote_required';

export type FareConditionConfidence =
  | 'confirmed'
  | 'medium'
  | 'unknown'
  | 'live_quote_required';

export type FareConditionUiLabel =
  | 'Confirmed'
  | 'Based on airline fare-family guidance'
  | 'Exact rule unavailable'
  | 'We will confirm before you proceed';

export interface FareConditionLine {
  label: string;
  value: string;
  source: FareConditionSource;
  confidence: FareConditionConfidence;
  uiLabel: FareConditionUiLabel;
}

export interface FareConditionBlock {
  simpleSummary: string;
  source: FareConditionSource;
  confidence: FareConditionConfidence;
  uiLabel: FareConditionUiLabel;
  caveat?: string;
}

function titleCase(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function bagLabel(count: number | undefined) {
  if (count == null) return undefined;
  return count === 0 ? 'No checked bags shown' : `${count} checked bag${count === 1 ? '' : 's'} shown`;
}

function hasProviderPolicy(summary?: string) {
  if (!summary) return false;
  return !summary.toLowerCase().includes('details unavailable');
}

function brandTokens(brand?: string) {
  return (brand ?? '').toLowerCase();
}

function sourceLabel(source: FareConditionSource, confidence: FareConditionConfidence): FareConditionUiLabel {
  if (source === 'duffel' && confidence === 'confirmed') return 'Confirmed';
  if (source === 'airline_fare_family_guidance') return 'Based on airline fare-family guidance';
  if (source === 'live_quote_required') return 'We will confirm before you proceed';
  return 'Exact rule unavailable';
}

function line(
  label: string,
  value: string,
  source: FareConditionSource,
  confidence: FareConditionConfidence,
): FareConditionLine {
  return {
    label,
    value,
    source,
    confidence,
    uiLabel: sourceLabel(source, confidence),
  };
}

function block(
  simpleSummary: string,
  source: FareConditionSource,
  confidence: FareConditionConfidence,
  caveat?: string,
): FareConditionBlock {
  return {
    simpleSummary,
    source,
    confidence,
    uiLabel: sourceLabel(source, confidence),
    caveat,
  };
}

function cabinLabel(input: string) {
  return titleCase(input || 'economy');
}

interface AirlineFareProfile {
  customerLabel: string;
  bestFor: string;
  changeSummary: string;
  refundSummary: string;
  possibleBenefits: string[];
  caveat: string;
}

function profile(
  customerLabel: string,
  bestFor: string,
  changeSummary: string,
  refundSummary: string,
  possibleBenefits: string[],
  caveat = 'Exact eligibility depends on fare basis, route, and final airline ticket rules.',
): AirlineFareProfile {
  return { customerLabel, bestFor, changeSummary, refundSummary, possibleBenefits, caveat };
}

function airlineFareFamilyProfile(airline: string, brand: string | undefined, cabin: string): AirlineFareProfile | null {
  const airlineLower = airline.toLowerCase();
  const brandLower = brandTokens(brand);
  const isFlex = /\bflex\b|flexi|flexible|select pro|fully flexible|extra/.test(brandLower);
  const isPlus = /plus|select|standard|classic/.test(brandLower);
  const isRestrictive = /essential|basic|light|value|saver/.test(brandLower);
  const isPremiumEconomy = cabin.toLowerCase().includes('premium');

  if (airlineLower.includes('lufthansa')) {
    if (isFlex && isPremiumEconomy) {
      return profile(
        'Lufthansa Premium Economy Flex fare-family option',
        'Travellers who want lower change friction and stronger refund flexibility',
        'Lufthansa fare-family guidance lists Premium Economy Flex rebooking as free; fare difference may still apply.',
        'Lufthansa fare-family guidance lists Premium Economy Flex refund as free, subject to final ticket rules.',
        [
          'Free rebooking guidance for Premium Economy Flex',
          'Refundable fare-family guidance for Premium Economy Flex',
          'Mileage upgrade eligibility and higher mileage credit may apply on Lufthansa-marketed flights',
        ],
      );
    }
    if (isPlus && isPremiumEconomy) {
      return profile(
        'Lufthansa Premium Economy Basic Plus fare-family option',
        'Travellers who want some refund flexibility without paying for full Flex',
        'Lufthansa fare-family guidance lists rebooking with an airline fee plus any fare difference.',
        'Lufthansa fare-family guidance lists refunds with an airline fee, subject to final ticket rules.',
        [
          'More flexible than Basic, usually below full Flex pricing',
          'Advanced seat reservation is typically part of the Premium Economy fare family',
        ],
      );
    }
    if (isRestrictive && isPremiumEconomy) {
      return profile(
        'Lufthansa Premium Economy Basic fare-family option',
        'Travellers with firm plans who want the lowest Premium Economy price',
        'Lufthansa fare-family guidance lists rebooking with an airline fee plus any fare difference.',
        'Lufthansa fare-family guidance lists this fare family as non-refundable.',
        [
          'Lowest Premium Economy fare family shown',
          'Advanced seat reservation is typically part of the Premium Economy fare family',
        ],
      );
    }
  }

  if (airlineLower.includes('cathay')) {
    if (isFlex) {
      return profile(
        `Most flexible ${cabin} fare-family option shown`,
        'Travellers whose dates may change',
        'Cathay fare-family guidance points Flex fares toward easier date or flight changes; fare difference may still apply.',
        'Cancellation fees and refund value depend on the exact fare rules for the ticket.',
        [
          'Higher-flexibility fare family',
          'Date or flight changes may be easier within the same route',
          'Seat-selection, upgrade, or standby benefits may apply depending on route and fare rules',
        ],
      );
    }
    if (brandLower.includes('essential')) {
      return profile(
        `${cabin} Essential fare-family option shown`,
        'Travellers who want a lower fare and can accept more restrictions',
        'Changes may carry airline fees and fare difference, depending on ticket rules.',
        'Refunds are usually more restricted than Flex and depend on final ticket rules.',
        ['Lower-priced fare family with fewer flexibility benefits than Flex'],
      );
    }
  }

  if (airlineLower.includes('british airways')) {
    if (isFlex || brandLower.includes('pro')) {
      return profile(
        `${cabin} flexible fare-family option shown`,
        'Travellers who may need to change or cancel before departure',
        'British Airways guidance treats flexible fare families as easier to change; fare difference may still apply.',
        'Refund eligibility depends on the fare type and final ticket rules.',
        [
          'Higher-flexibility fare family',
          'Seat selection or same-day change benefits may apply depending on route and fare rules',
        ],
      );
    }
    if (isPlus || brandLower.includes('select')) {
      return profile(
        `${cabin} Select fare-family option shown`,
        'Travellers who want more flexibility than the lowest fare',
        'Change rules are usually less restrictive than Basic, but final ticket rules control fees.',
        'Refund value depends on the exact fare rules.',
        ['More flexible fare family than Basic on many British Airways routes'],
      );
    }
  }

  if (airlineLower.includes('air canada')) {
    if (isFlex) {
      return profile(
        `${cabin} Flex fare-family option shown`,
        'Travellers who want advance seat choice and lower change friction',
        'Air Canada fare-family guidance lists Flex as more change-friendly; fare difference may still apply.',
        'Refund eligibility depends on the exact fare option and ticket rules.',
        [
          'Advance seat-selection benefits may apply',
          'Lower change-fee guidance than more restrictive fare families',
          'Upgrade eligibility may apply for eligible Aeroplan members and routes',
        ],
      );
    }
  }

  if (airlineLower.includes('delta')) {
    if (isFlex || brandLower.includes('extra')) {
      return profile(
        `${cabin} refundable or extra fare-family option shown`,
        'Travellers who want a more flexible ticket than Basic or Classic',
        'Delta guidance separates non-refundable and refundable fare families; fare difference may still apply.',
        'Refundability depends on the fare category returned for the exact ticket.',
        ['More flexible fare family than Basic or Classic when sold as Extra or Refundable'],
      );
    }
  }

  return null;
}

function fareFamilyProfile(airline: string, brand: string | undefined, cabin: string) {
  const airlineSpecific = airlineFareFamilyProfile(airline, brand, cabin);
  if (airlineSpecific) return airlineSpecific;

  const airlineLower = airline.toLowerCase();
  const brandLower = brandTokens(brand);
  const isFlex = /\bflex\b|flexi|flexible/.test(brandLower);
  const isEssential = /essential|basic|light|value|saver/.test(brandLower);
  const isPremiumCabin = cabin.toLowerCase().includes('premium');

  if (airlineLower.includes('cathay') && isFlex) {
    return {
      customerLabel: `Most flexible ${cabin} fare-family option shown`,
      bestFor: 'Travellers whose dates may change',
      changeSummary: 'Airline change fee may be waived, but fare difference may still apply.',
      refundSummary: 'Cancellation fee may still apply. Exact refund amount depends on ticket rules.',
      possibleBenefits: [
        'Higher-flexibility fare family',
        'Better seat-selection, upgrade, or standby benefits may apply depending on route and fare rules',
      ],
      caveat: 'Do not treat this as fully refundable or freely changeable unless the provider confirms it for this exact offer.',
    };
  }

  if (isFlex) {
    return {
      customerLabel: `${cabin} flexible fare-family option shown`,
      bestFor: 'Travellers who want more flexibility if plans change',
      changeSummary: 'Airline change fee is often lower or waived, but fare difference may still apply.',
      refundSummary: 'Cancellation fee may apply. Refund amount depends on the final ticket rules.',
      possibleBenefits: [
        'Higher-flexibility fare family',
        isPremiumCabin
          ? 'Seat-selection, upgrade, or standby benefits may apply depending on route and fare rules'
          : 'Seat-selection or same-day change benefits may apply depending on route and fare rules',
      ],
      caveat: 'Exact eligibility depends on fare basis, route, and final airline ticket rules.',
    };
  }

  if (isEssential) {
    return {
      customerLabel: `${cabin} lowest-fare family shown`,
      bestFor: 'Travellers with firm plans who want the lowest price',
      changeSummary: 'Changes are usually restricted and may not be allowed.',
      refundSummary: 'Refunds are usually restricted and may not be available.',
      possibleBenefits: ['Lowest available fare family for this flight'],
      caveat: 'Restrictions can vary by route and final ticket rules.',
    };
  }

  return {
    customerLabel: `${brand || cabin} fare family shown`,
    bestFor: 'Travellers comparing price, bags, and flexibility before checkout',
    changeSummary: 'Change rules were not specific enough in the search result.',
    refundSummary: 'Refund rules were not specific enough in the search result.',
    possibleBenefits: ['Fare-family benefits depend on airline, route, and ticket rules'],
    caveat: 'Exact fees, refund amounts, no-show penalties, and eligibility are governed by the final airline ticket rules.',
  };
}

export function enrichFareConditions(input: FareTermsInput): CustomerFareTerms {
  const brand = input.fareBrandName?.trim();
  const brandLower = brandTokens(brand);
  const cabin = cabinLabel(input.cabinClass);
  const displayName = brand || cabin;
  const priceDelta = Math.max(0, input.price - (input.baselinePrice ?? input.price));
  const profile = fareFamilyProfile(input.airline, brand, cabin);
  const inclusions: FareConditionLine[] = [];
  const possibleBenefits: FareConditionLine[] = [];
  const caveats: string[] = [];

  const bags = bagLabel(input.checkedBags);
  if (bags) inclusions.push(line('Checked baggage', bags, 'duffel', 'confirmed'));

  if (input.baselineCheckedBags != null && input.checkedBags != null && input.checkedBags > input.baselineCheckedBags) {
    inclusions.push(line(
      'Extra checked baggage',
      `${input.checkedBags - input.baselineCheckedBags} more checked bag${input.checkedBags - input.baselineCheckedBags === 1 ? '' : 's'} than the lowest fare`,
      'duffel',
      'confirmed',
    ));
  }

  const providerPolicy = hasProviderPolicy(input.flexibilitySummary);
  const hasProviderRefund = input.refundable != null && providerPolicy;
  const hasProviderChange = input.changeable != null && providerPolicy;

  const changeTerms = hasProviderChange
    ? block(
        input.changeable
          ? 'Changes are allowed by this quote. Fare difference may still apply.'
          : 'Changes are not allowed by the structured fare rules returned for this quote.',
        'duffel',
        'confirmed',
        input.flexibilitySummary,
      )
    : block(
        profile.changeSummary,
        brand ? 'airline_fare_family_guidance' : 'ticket_rules_apply',
        brand ? 'medium' : 'unknown',
        profile.caveat,
      );

  const refundTerms = hasProviderRefund
    ? block(
        input.refundable
          ? 'Refundable before departure, subject to airline rules and any listed penalties.'
          : 'Non-refundable before departure by the structured fare rules returned for this quote.',
        'duffel',
        'confirmed',
        input.flexibilitySummary,
      )
    : block(
        profile.refundSummary,
        brand ? 'airline_fare_family_guidance' : 'ticket_rules_apply',
        brand ? 'medium' : 'unknown',
        profile.caveat,
      );

  let source: CustomerFareTerms['source'] = providerPolicy ? 'Duffel conditions' : 'Ticket rules apply';
  let confidenceScore = providerPolicy ? 0.9 : 0.45;

  if (brand) {
    source = 'Airline fare-family guidance';
    confidenceScore = providerPolicy ? 0.72 : 0.62;
  }

  for (const benefit of profile.possibleBenefits) {
    possibleBenefits.push(line('Possible fare-family benefit', benefit, 'airline_fare_family_guidance', 'medium'));
  }

  if (brandLower.includes('flex')) {
    if (priceDelta > 0) {
      caveats.push(`This fare is ${formatPrice(priceDelta, input.currency)} more than the lowest shown fare; exact fees and eligibility are verified again before payment.`);
    }
  }

  if (brandLower.includes('essential') || brandLower.includes('basic') || brandLower.includes('light')) {
    caveats.push('This appears to be the restrictive fare family for this cabin.');
  }

  if (inclusions.length === 0) {
    inclusions.push(line('Included benefits', 'No extra inclusions were visible in the search response.', 'ticket_rules_apply', 'unknown'));
  }

  if (profile.caveat && profile.caveat !== CHECKOUT_DISCLAIMER) {
    caveats.push(profile.caveat);
  }

  const confidenceLabel: CustomerFareTerms['confidenceLabel'] =
    confidenceScore >= 0.8 ? 'Confirmed' :
    confidenceScore >= 0.6 ? 'Based on airline fare-family guidance' :
    'Exact rule unavailable';

  const summary = priceDelta > 0
    ? `${displayName} is ${formatPrice(priceDelta, input.currency)} more than the lowest fare shown.`
    : `${displayName} is the lowest fare shown for this flight.`;

  return {
    displayName,
    customerLabel: profile.customerLabel,
    bestFor: profile.bestFor,
    summary,
    knownInclusions: Array.from(new Set(inclusions)),
    changeTerms,
    refundTerms,
    possibleBenefits: Array.from(new Set(possibleBenefits)),
    caveats: Array.from(new Set(caveats)),
    confidenceScore,
    confidenceLabel,
    source,
    checkoutDisclaimer: CHECKOUT_DISCLAIMER,
  };
}
