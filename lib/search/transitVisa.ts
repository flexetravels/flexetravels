import type { NormalizedFlight } from './types';

export interface TransitProfile {
  passportCountry?: string;
  visaCountries?: string[];
  mode?: 'filter' | 'warn';
}

export interface TransitVisaIssue {
  airport: string;
  country: string;
  countryCode: string;
  severity: 'blocked' | 'review';
  summary: string;
  sourceUrl: string;
}

// Airport-country mapping for major transit hubs returned by Duffel on routes
// FlexeTravels currently sells most often. Unknown airports are not blocked;
// they can still be shown with generic document caveats.
const AIRPORT_COUNTRY: Record<string, { code: string; name: string }> = {
  // United States
  ATL: { code: 'US', name: 'United States' }, BOS: { code: 'US', name: 'United States' },
  DFW: { code: 'US', name: 'United States' }, EWR: { code: 'US', name: 'United States' },
  IAD: { code: 'US', name: 'United States' }, IAH: { code: 'US', name: 'United States' },
  JFK: { code: 'US', name: 'United States' }, LAX: { code: 'US', name: 'United States' },
  MIA: { code: 'US', name: 'United States' }, ORD: { code: 'US', name: 'United States' },
  SEA: { code: 'US', name: 'United States' }, SFO: { code: 'US', name: 'United States' },
  // Canada
  YYC: { code: 'CA', name: 'Canada' }, YUL: { code: 'CA', name: 'Canada' },
  YVR: { code: 'CA', name: 'Canada' }, YYZ: { code: 'CA', name: 'Canada' },
  // United Kingdom
  LHR: { code: 'GB', name: 'United Kingdom' }, LGW: { code: 'GB', name: 'United Kingdom' },
  MAN: { code: 'GB', name: 'United Kingdom' },
  // Schengen / Europe high-traffic hubs
  AMS: { code: 'NL', name: 'Netherlands' }, CDG: { code: 'FR', name: 'France' },
  FRA: { code: 'DE', name: 'Germany' }, MUC: { code: 'DE', name: 'Germany' },
  ZRH: { code: 'CH', name: 'Switzerland' }, MAD: { code: 'ES', name: 'Spain' },
  FCO: { code: 'IT', name: 'Italy' }, LIS: { code: 'PT', name: 'Portugal' },
  // Middle East / Asia hubs generally checked at destination/airline level.
  AUH: { code: 'AE', name: 'United Arab Emirates' }, DXB: { code: 'AE', name: 'United Arab Emirates' },
  DOH: { code: 'QA', name: 'Qatar' }, SIN: { code: 'SG', name: 'Singapore' },
  HKG: { code: 'HK', name: 'Hong Kong' }, ICN: { code: 'KR', name: 'South Korea' },
  NRT: { code: 'JP', name: 'Japan' }, HND: { code: 'JP', name: 'Japan' },
  BKK: { code: 'TH', name: 'Thailand' }, KUL: { code: 'MY', name: 'Malaysia' },
};

const SCHENGEN = new Set(['AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HU', 'IS', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'SE', 'SI', 'SK']);

const VISA_REQUIRED_TO_TRANSIT_CANADA = new Set(['IN']);
const DATV_REVIEW_PASSPORTS = new Set(['IN']);
const SCHENGEN_ATV_REVIEW_PASSPORTS = new Set(['IN']);

export function evaluateTransitVisaIssues(flight: NormalizedFlight, profile?: TransitProfile): TransitVisaIssue[] {
  const passport = profile?.passportCountry?.trim().toUpperCase();
  if (!passport) return [];

  const held = new Set((profile?.visaCountries ?? []).map(c => c.trim().toUpperCase()).filter(Boolean));
  const stopCountries = transitCountriesForFlight(flight);
  const issues: TransitVisaIssue[] = [];

  for (const [countryCode, airport] of stopCountries) {
    const country = AIRPORT_COUNTRY[airport]?.name ?? countryCode;
    if (countryCode === passport || held.has(countryCode)) continue;

    if (countryCode === 'US' && passport !== 'CA' && passport !== 'BM') {
      issues.push({
        airport,
        country,
        countryCode,
        severity: 'blocked',
        summary: `Transit via ${airport} enters the United States. Travellers with a ${passport} passport generally need a valid U.S. visa or eligible visa-waiver status before transiting.`,
        sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/other-visa-categories/transit.html',
      });
      continue;
    }

    if (countryCode === 'CA' && VISA_REQUIRED_TO_TRANSIT_CANADA.has(passport)) {
      issues.push({
        airport,
        country,
        countryCode,
        severity: 'blocked',
        summary: `Transit via ${airport} enters Canada. A ${passport} passport holder may need a Canadian transit visa unless they already hold valid Canadian visitor/transit status or another exemption applies.`,
        sourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/transit.html',
      });
      continue;
    }

    if (countryCode === 'GB' && DATV_REVIEW_PASSPORTS.has(passport)) {
      issues.push({
        airport,
        country,
        countryCode,
        severity: 'review',
        summary: `Transit via ${airport} may require a UK Direct Airside Transit or Visitor in Transit visa depending on whether border control is involved and what visas/residence permits the traveller already holds.`,
        sourceUrl: 'https://www.gov.uk/transit-visa',
      });
      continue;
    }

    if (SCHENGEN.has(countryCode) && SCHENGEN_ATV_REVIEW_PASSPORTS.has(passport) && !held.has('EU') && !held.has('SCHENGEN')) {
      issues.push({
        airport,
        country,
        countryCode,
        severity: 'review',
        summary: `Transit via ${airport} may require airport-transit-document review for a ${passport} passport. Rules vary by Schengen country, airline, and whether the traveller leaves the international transit area.`,
        sourceUrl: 'https://travel-europe.europa.eu/ees_en',
      });
    }
  }

  return issues;
}

export function transitCountriesForFlight(flight: NormalizedFlight): Map<string, string> {
  const airports = new Set<string>();
  for (const s of flight.stopAirports ?? []) airports.add(s);
  for (const s of flight.returnStopAirports ?? []) airports.add(s);
  for (const leg of flight.legs ?? []) {
    for (const s of leg.stopAirports ?? []) airports.add(s);
    for (let i = 0; i < (leg.segments ?? []).length - 1; i++) {
      const segment = leg.segments[i];
      if (segment?.destination) airports.add(segment.destination);
    }
  }

  const countries = new Map<string, string>();
  for (const airport of airports) {
    const code = airport.trim().toUpperCase();
    const country = AIRPORT_COUNTRY[code];
    if (!country) continue;
    if (!countries.has(country.code)) countries.set(country.code, code);
  }
  return countries;
}
