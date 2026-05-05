// ─── Checkout totals — pure, tested fare/breakdown math ─────────────────────
// Used by CheckoutCard + the booking page so the displayed breakdown ALWAYS
// sums to the line totals. Two regressions this fixes:
//   1. The old per-pax breakdown divided flightTotal evenly across
//      (adults + children), then displayed "Lap seat" for infants without
//      redistributing the infant's notional share — so the sum of rows was
//      LESS than the flight total (a $654 fare became $436 + Lap seat,
//      leaving an apparent $218 unaccounted for).
//   2. The aggregate "Trip total" needs to handle multi-leg cleanly with
//      a single currency check (mixed-currency trips show a hint instead
//      of a wrong sum).
//
// Pure, no React, no fetch — exhaustively unit-testable.

export interface FlightInput {
  /** Flight total fare (all passengers, what Duffel returned). */
  totalAmount: number;
  /** ISO currency code, upper case. */
  currency:    string;
  /** Number of adults paying. */
  adults:      number;
  /** Per-child ages. Length is the child count; entries are integer years 0–17. */
  childAges:   number[];
}

export interface FareLine {
  kind:    'adult' | 'child' | 'infant';
  /** Display label, e.g. "2 × Adult", "Toddler (age 3)", "Infant (age 1) — lap seat". */
  label:   string;
  /** Per-line subtotal in the same currency as the flight. Always >= 0. */
  amount:  number;
  /** Lap-seat infants render as 0 with a parenthetical note. */
  zeroFare: boolean;
}

export interface FlightFareBreakdown {
  totalAmount: number;
  currency:    string;
  lines:       FareLine[];
  /** True when the breakdown sums exactly to totalAmount (always true for valid input). */
  reconciled:  boolean;
  /**
   * Notional adult-equivalent unit price the airline used to allocate the fare.
   * Useful for tooltips ("each adult ≈ $X"). NOT what Duffel reports per pax —
   * airlines vary, this is our heuristic.
   */
  adultUnitAmount: number;
}

// Heuristics used to allocate fare by passenger type.
//   - Lap infant (< 2 yo): pays 0 (carrier may charge a small lap fee at booking,
//     but for the breakdown it's 0). Their share is absorbed by adults.
//   - Child (2–11): pays ~75% of an adult fare.
//   - Adult (12+ or no age): full fare.
// These are heuristics — exact per-pax fare is confirmed at booking. The point
// here is that the ROWS ALWAYS SUM TO THE FLIGHT TOTAL.
const CHILD_FARE_FRACTION = 0.75;

function classify(age: number): FareLine['kind'] {
  if (age < 2)  return 'infant';
  if (age < 12) return 'child';
  return 'adult';
}

function ageLabel(age: number, kind: FareLine['kind']): string {
  if (kind === 'infant') return `Infant (age ${age}) — lap seat`;
  if (kind === 'child' && age <= 3) return `Toddler (age ${age})`;
  if (kind === 'child') return `Child (age ${age})`;
  return `Child (age ${age}) — adult fare applies`;
}

/**
 * Split a flight's total fare across adults + children + infants such that
 * the rows ALWAYS sum to totalAmount. Lap infants (< 2 yo) pay 0 here; their
 * notional share is absorbed by adults via the unit-price calculation.
 *
 * Rounding: amounts are rounded to two decimals; the final "adult" row is
 * adjusted so the sum equals totalAmount exactly even after rounding error.
 */
export function splitFlightFare(input: FlightInput): FlightFareBreakdown {
  const { currency } = input;
  const totalAmount = Math.max(0, Number(input.totalAmount) || 0);
  const adults     = Math.max(0, Math.floor(input.adults));
  const childAges  = (input.childAges ?? []).map(a => Math.max(0, Math.min(17, Math.floor(a))));

  // Bucket children
  const infants = childAges.filter(a => classify(a) === 'infant');
  const olderChildren = childAges.filter(a => classify(a) !== 'infant');
  // Children aged 12+ are charged at the full adult fare in airline practice.
  const fullFareChildren = olderChildren.filter(a => a >= 12);
  const discountedChildren = olderChildren.filter(a => a < 12);

  // Adult-equivalent units that share the paid total. Infants contribute 0.
  const adultUnits  = adults + fullFareChildren.length;
  const childUnits  = discountedChildren.length * CHILD_FARE_FRACTION;
  const totalUnits  = adultUnits + childUnits;

  const adultUnit = totalUnits > 0 ? totalAmount / totalUnits : 0;
  const childUnit = adultUnit * CHILD_FARE_FRACTION;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const lines: FareLine[] = [];

  if (adultUnits > 0) {
    lines.push({
      kind:     'adult',
      label:    `${adultUnits} × Adult`,
      amount:   round2(adultUnit * adultUnits),
      zeroFare: false,
    });
  }

  // One row per discounted child so users see ages reflected.
  for (const age of discountedChildren) {
    lines.push({
      kind:     'child',
      label:    ageLabel(age, 'child'),
      amount:   round2(childUnit),
      zeroFare: false,
    });
  }

  // Infants — always $0 line with a clear "lap seat" note.
  for (const age of infants) {
    lines.push({
      kind:     'infant',
      label:    ageLabel(age, 'infant'),
      amount:   0,
      zeroFare: true,
    });
  }

  // Reconciliation pass — if rounding produced a sub-cent drift, push it onto
  // the first paying line so the displayed rows sum to the exact flight total.
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const drift = round2(totalAmount - sum);
  if (drift !== 0) {
    const target = lines.find(l => !l.zeroFare);
    if (target) target.amount = round2(target.amount + drift);
  }

  // Final reconciliation check (should always be true)
  const reconciled = Math.abs(
    lines.reduce((s, l) => s + l.amount, 0) - totalAmount,
  ) < 0.01;

  return {
    totalAmount,
    currency,
    lines,
    reconciled,
    adultUnitAmount: round2(adultUnit),
  };
}

// ─── Trip total — multi-leg + multi-hotel + flat $20 USD service fee ─────────

export interface PricedItem {
  amount:   number;
  currency: string;
}

export interface TripTotal {
  /** Total in the trip's currency. Service fee is added only when currency is USD. */
  total:        number;
  /** Sub-total without the service fee. */
  subtotal:     number;
  /** Always 20 when currency === 'USD', else 0 (charged separately). */
  serviceFee:   number;
  currency:     string;
  /** True when every line item is in the same currency. */
  singleCurrency: boolean;
  /** Distinct currencies seen — used to render a "mixed currencies" hint when > 1. */
  currencies:   string[];
}

const SERVICE_FEE_USD = 20;

/**
 * Sum every flight + hotel line into a single trip total. When line items are
 * in mixed currencies we DON'T attempt to convert — instead the caller can
 * render a "mixed currencies — see per-line breakdown" hint, since adding USD
 * + EUR would mislead users about what they're being charged.
 */
export function computeTripTotal(items: PricedItem[]): TripTotal {
  const cleaned = items
    .filter(i => Number.isFinite(i.amount) && i.amount >= 0)
    .map(i => ({ amount: i.amount, currency: (i.currency || 'USD').toUpperCase() }));

  const currencies = Array.from(new Set(cleaned.map(i => i.currency)));
  const singleCurrency = currencies.length === 1;
  const currency = singleCurrency ? currencies[0] : (currencies[0] ?? 'USD');

  if (cleaned.length === 0) {
    return { total: 0, subtotal: 0, serviceFee: 0, currency: 'USD', singleCurrency: true, currencies: [] };
  }

  if (!singleCurrency) {
    // Sub-total in the first currency we saw (only for that currency's items)
    const first = cleaned.filter(i => i.currency === currency);
    const sub   = first.reduce((s, i) => s + i.amount, 0);
    return {
      total:          sub,
      subtotal:       sub,
      serviceFee:     0,
      currency,
      singleCurrency: false,
      currencies,
    };
  }

  const subtotal   = cleaned.reduce((s, i) => s + i.amount, 0);
  const serviceFee = currency === 'USD' ? SERVICE_FEE_USD : 0;
  return {
    total:          Math.round((subtotal + serviceFee) * 100) / 100,
    subtotal:       Math.round(subtotal * 100) / 100,
    serviceFee,
    currency,
    singleCurrency: true,
    currencies,
  };
}
