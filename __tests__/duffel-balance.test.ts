import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDuffelBalanceForFare, customerSafeBalanceMessage } from '@/lib/duffel/balance';
import { customerSafeBookingError } from '@/lib/errors/customer';

const originalToken = process.env.DUFFEL_ACCESS_TOKEN;

afterEach(() => {
  process.env.DUFFEL_ACCESS_TOKEN = originalToken;
  vi.restoreAllMocks();
});

describe('Duffel balance guard', () => {
  it('blocks when balance is below fare plus buffer', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { available_balance: '1000.00', currency: 'USD' },
    }), { status: 200 })));

    const result = await checkDuffelBalanceForFare({
      fareAmountCents: 120000,
      fareCurrency: 'USD',
      bufferCents: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('DUFFEL_BALANCE_LOW');
    expect(result.requiredCents).toBe(125000);
  });

  it('passes when balance covers fare plus buffer', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { available_balance: '1300.00', currency: 'USD' },
    }), { status: 200 })));

    const result = await checkDuffelBalanceForFare({
      fareAmountCents: 120000,
      fareCurrency: 'USD',
      bufferCents: 5000,
    });

    expect(result.ok).toBe(true);
    expect(result.availableCents).toBe(130000);
  });

  it('does not expose internal supplier balance details in customer errors', () => {
    expect(customerSafeBalanceMessage()).not.toMatch(/Duffel|balance/i);
    expect(customerSafeBookingError('DUFFEL_BALANCE_LOW')).not.toMatch(/Duffel|balance/i);
  });
});
