import { expect, test } from '@playwright/test';
import {
  splitFlightFare, computeTripTotal,
} from '../lib/checkout/totals';

// ─── Pure-function tests for the checkout fare math ─────────────────────────
//
// These are unit-style tests run via Playwright's runner so they share the
// existing harness. Two regressions they lock down:
//
//   1. The OLD per-pax breakdown divided flight total evenly across
//      (adults + children), then displayed "Lap seat" for infants without
//      redistributing the infant's share — so the rendered rows added up to
//      LESS than the flight total. The new splitFlightFare reconciles to the
//      exact total.
//
//   2. computeTripTotal must NOT add the $20 service fee when items are in
//      a non-USD currency (the fee is charged separately by Stripe in USD).

test.describe('splitFlightFare — pure math', () => {
  test('2 adults, no children → single adult row equal to total', () => {
    const r = splitFlightFare({ totalAmount: 654, currency: 'USD', adults: 2, childAges: [] });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].kind).toBe('adult');
    expect(r.lines[0].amount).toBe(654);
    expect(r.reconciled).toBe(true);
  });

  test('2 adults + 1 lap infant (age 1) → infant is $0; adults absorb full fare', () => {
    const r = splitFlightFare({ totalAmount: 654, currency: 'USD', adults: 2, childAges: [1] });
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(654);          // ROWS SUM TO TOTAL — the regression
    const adultLine = r.lines.find(l => l.kind === 'adult')!;
    const infantLine = r.lines.find(l => l.kind === 'infant')!;
    expect(adultLine.amount).toBe(654);
    expect(infantLine.amount).toBe(0);
    expect(infantLine.zeroFare).toBe(true);
    expect(infantLine.label).toMatch(/lap seat/i);
  });

  test('2 adults + 1 child age 5 → child priced at 75% of adult unit', () => {
    const r = splitFlightFare({ totalAmount: 1000, currency: 'USD', adults: 2, childAges: [5] });
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.abs(sum - 1000)).toBeLessThan(0.02);
    const child = r.lines.find(l => l.kind === 'child')!;
    const adult = r.lines.find(l => l.kind === 'adult')!;
    // 2 adult units + 0.75 child unit = 2.75 units → $363.64/unit; child = 272.73; 2 adults = 727.27
    expect(adult.amount).toBeCloseTo(727.27, 1);
    expect(child.amount).toBeCloseTo(272.73, 1);
  });

  test('2 adults + 1 toddler (age 3) labels as "Toddler"', () => {
    const r = splitFlightFare({ totalAmount: 800, currency: 'USD', adults: 2, childAges: [3] });
    const child = r.lines.find(l => l.kind === 'child')!;
    expect(child.label).toMatch(/toddler/i);
    expect(child.label).toMatch(/age 3/);
  });

  test('1 adult + 13-year-old child → both treated as adult fare', () => {
    const r = splitFlightFare({ totalAmount: 600, currency: 'USD', adults: 1, childAges: [13] });
    // 13yo is full adult fare → adult row should be 2 units
    const adult = r.lines.find(l => l.kind === 'adult')!;
    expect(adult.label).toMatch(/2 × Adult/);
    expect(adult.amount).toBe(600);
  });

  test('2 adults + 1 infant + 1 toddler → reconciles exactly', () => {
    const r = splitFlightFare({ totalAmount: 999, currency: 'USD', adults: 2, childAges: [1, 3] });
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.abs(sum - 999)).toBeLessThan(0.02);
    expect(r.reconciled).toBe(true);
    expect(r.lines.filter(l => l.kind === 'infant')).toHaveLength(1);
    expect(r.lines.filter(l => l.kind === 'child')).toHaveLength(1);
  });

  test('rounding: $100 / 3 units gives lines that still sum exactly', () => {
    const r = splitFlightFare({ totalAmount: 100, currency: 'USD', adults: 3, childAges: [] });
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(100);
  });

  test('handles zero adults + only children gracefully', () => {
    const r = splitFlightFare({ totalAmount: 200, currency: 'USD', adults: 0, childAges: [5] });
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBeCloseTo(200, 1);
  });

  test('handles all-infant input — produces zero rows summing to 0 even though total > 0', () => {
    // Edge case: technically not valid input, but shouldn't crash.
    const r = splitFlightFare({ totalAmount: 100, currency: 'USD', adults: 0, childAges: [0, 1] });
    // No paying units → can't allocate; rows are all $0
    const sum = r.lines.reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(0);
  });
});

test.describe('computeTripTotal — multi-leg + currency handling', () => {
  test('all-USD: subtotal + $20 service fee', () => {
    const t = computeTripTotal([
      { amount: 654, currency: 'USD' },
      { amount: 697, currency: 'USD' },
    ]);
    expect(t.singleCurrency).toBe(true);
    expect(t.currency).toBe('USD');
    expect(t.subtotal).toBe(1351);
    expect(t.serviceFee).toBe(20);
    expect(t.total).toBe(1371);
  });

  test('all-EUR: NO service fee added (it is charged separately in USD)', () => {
    const t = computeTripTotal([
      { amount: 1200, currency: 'EUR' },
      { amount: 800,  currency: 'EUR' },
    ]);
    expect(t.singleCurrency).toBe(true);
    expect(t.currency).toBe('EUR');
    expect(t.serviceFee).toBe(0);
    expect(t.total).toBe(2000);
  });

  test('mixed currencies: singleCurrency false, hint should be shown', () => {
    const t = computeTripTotal([
      { amount: 600, currency: 'USD' },
      { amount: 500, currency: 'EUR' },
    ]);
    expect(t.singleCurrency).toBe(false);
    expect(t.currencies.sort()).toEqual(['EUR', 'USD']);
  });

  test('multi-leg all-USD: 2 flights + 2 hotels + service fee', () => {
    const t = computeTripTotal([
      { amount: 600, currency: 'USD' },
      { amount: 900, currency: 'USD' },
      { amount: 1800, currency: 'USD' },
      { amount: 3000, currency: 'USD' },
    ]);
    expect(t.subtotal).toBe(6300);
    expect(t.total).toBe(6320);
  });

  test('empty items: total = 0, no service fee', () => {
    const t = computeTripTotal([]);
    expect(t.total).toBe(0);
    expect(t.serviceFee).toBe(0);
  });

  test('case-insensitive currency: usd === USD === Usd', () => {
    const t = computeTripTotal([
      { amount: 100, currency: 'usd' },
      { amount: 200, currency: 'USD' },
    ]);
    expect(t.singleCurrency).toBe(true);
    expect(t.total).toBe(320);
  });
});

// ─── UI test: real /booking page renders the fix ─────────────────────────────

test.describe('Checkout UI — breakdown sums to flight total', () => {
  test('multi-pax flight (2 adults + 1 toddler age 3) renders rows that visibly sum to fare', async ({ page }) => {
    // Seed ft_cart on the homepage origin, then load /booking
    await page.goto('/');
    await page.evaluate(() => {
      window.sessionStorage.setItem('ft_cart', JSON.stringify({
        flight: {
          id: 'f1', offerId: 'f1',
          airline: 'WestJet', origin: 'YVR', destination: 'YYZ',
          departure: '2026-05-17T08:00:00', arrival: '2026-05-17T11:35:00',
          duration: '3h 35m', stops: 0, price: 800, currency: 'USD',
          cabinClass: 'economy',
        },
        flights: [],
        hotel: undefined,
        hotels: [],
        adults: 2,
        children: { count: 1, ages: [3] },
        savedAt: Date.now(),
        source: 'canvas',
      }));
    });
    await page.goto('/booking');

    // Breakdown panel renders
    const panel = page.getByTestId('flight-pax-breakdown');
    await expect(panel).toBeVisible();

    // Three positive lines: 2 × Adult + Toddler — no negative or "~" ambiguity
    const text = await panel.innerText();
    expect(text).toMatch(/2 × Adult/);
    expect(text).toMatch(/Toddler/);
    expect(text).not.toMatch(/-\$/);    // never render as a deduction
    expect(text).not.toMatch(/~\$/);    // no ambiguous "approximately" prefix
    expect(text).toMatch(/sum to the \$800 total/);
  });

  test('lap-infant (age 1) shows "lap seat" + adults absorb full fare', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.sessionStorage.setItem('ft_cart', JSON.stringify({
        flight: {
          id: 'f1', offerId: 'f1',
          airline: 'WestJet', origin: 'YVR', destination: 'YYZ',
          departure: '2026-05-17T08:00:00', arrival: '2026-05-17T11:35:00',
          duration: '3h 35m', stops: 0, price: 654, currency: 'USD',
          cabinClass: 'economy',
        },
        flights: [],
        adults: 2,
        children: { count: 1, ages: [1] },
        savedAt: Date.now(),
        source: 'canvas',
      }));
    });
    await page.goto('/booking');

    const panel = page.getByTestId('flight-pax-breakdown');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    // Infant line is present and shows "included" instead of a price
    expect(text).toMatch(/Infant.*lap seat/i);
    expect(text).toMatch(/included/);
    // Adults line equals the full flight total
    expect(text).toMatch(/\$654/);
  });

  test('flight + hotel cart shows card charge separately from hotel payment', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.sessionStorage.setItem('ft_cart', JSON.stringify({
        flight: {
          id: 'f1', offerId: 'f1', airline: 'WestJet',
          origin: 'YVR', destination: 'YYZ',
          departure: '2026-05-17T08:00:00', arrival: '2026-05-17T11:35:00',
          duration: '3h 35m', stops: 0, price: 654, currency: 'USD',
          cabinClass: 'economy',
        },
        hotel: {
          id: 'h1', rateId: 'r1', bookingToken: 'liteapi_o1::r1',
          name: 'Crowne Plaza Toronto - North York by IHG', city: 'Toronto',
          checkIn: '2026-05-17', checkOut: '2026-05-21',
          pricePerNight: 174.25, totalPrice: 697, currency: 'USD',
        },
        adults: 2,
        children: { count: 0, ages: [] },
        savedAt: Date.now(),
        source: 'canvas',
      }));
    });
    await page.goto('/booking');

    const cardTotal = page.getByTestId('card-total-amount');
    await expect(cardTotal).toBeVisible();
    // Default billing location is BC: $654 flight + $20 service fee + $1 GST on fee.
    await expect(cardTotal).toContainText('$675');
    await expect(page.getByText(/Hotel paid separately after booking/)).toBeVisible();
  });
});
