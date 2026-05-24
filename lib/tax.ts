export const SERVICE_FEE_CENTS = 2000;

export type TaxCountry = 'CA' | 'US';

export interface TaxBreakdown {
  taxableAmountCents: number;
  taxCents: number;
  taxRateBps: number;
  taxLabel: string;
  jurisdiction: string;
  country: string;
  region: string;
}

export const CANADA_PROVINCES = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
] as const;

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

const CANADA_GST_HST_BPS: Record<string, { bps: number; label: string }> = {
  AB: { bps: 500, label: 'GST' },
  BC: { bps: 500, label: 'GST' },
  MB: { bps: 500, label: 'GST' },
  NB: { bps: 1500, label: 'HST' },
  NL: { bps: 1500, label: 'HST' },
  NS: { bps: 1400, label: 'HST' },
  NT: { bps: 500, label: 'GST' },
  NU: { bps: 500, label: 'GST' },
  ON: { bps: 1300, label: 'HST' },
  PE: { bps: 1500, label: 'HST' },
  QC: { bps: 500, label: 'GST' },
  SK: { bps: 500, label: 'GST' },
  YT: { bps: 500, label: 'GST' },
};

function normalizeCountry(country?: string) {
  return (country || 'CA').trim().toUpperCase();
}

function normalizeRegion(region?: string, country = 'CA') {
  const fallback = country === 'US' ? 'WA' : 'BC';
  return (region || fallback).trim().toUpperCase();
}

export function calculateServiceFeeTax({
  amountCents = SERVICE_FEE_CENTS,
  country = 'CA',
  region = 'BC',
}: {
  amountCents?: number;
  currency?: string;
  country?: string;
  region?: string;
}): TaxBreakdown {
  const normalizedCountry = normalizeCountry(country);
  const normalizedRegion = normalizeRegion(region, normalizedCountry);

  if (normalizedCountry === 'CA') {
    const rule = CANADA_GST_HST_BPS[normalizedRegion] ?? CANADA_GST_HST_BPS.BC;
    const taxCents = Math.round((amountCents * rule.bps) / 10_000);
    return {
      taxableAmountCents: amountCents,
      taxCents,
      taxRateBps: rule.bps,
      taxLabel: `${rule.label} ${(rule.bps / 100).toFixed(rule.bps % 100 ? 2 : 0)}%`,
      jurisdiction: `${normalizedRegion}, Canada`,
      country: normalizedCountry,
      region: normalizedRegion,
    };
  }

  return {
    taxableAmountCents: amountCents,
    taxCents: 0,
    taxRateBps: 0,
    taxLabel: 'Sales tax 0%',
    jurisdiction: normalizedCountry === 'US' ? `${normalizedRegion}, United States` : 'Outside Canada',
    country: normalizedCountry,
    region: normalizedRegion,
  };
}
