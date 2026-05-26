import { describe, expect, it } from 'vitest';
import { buildCartHash } from '@/lib/payments/ledger';

describe('payment ledger cart hash', () => {
  it('is stable for the same checkout inputs', () => {
    const input = {
      sessionId: 'session-1',
      bookingReference: 'pre_123',
      offerIds: ['off_b', 'off_a'],
      fareAmountCents: 120800,
      fareCurrency: 'usd',
      feeAmountCents: 2000,
      taxCents: 100,
      chargeAmountCents: 122900,
      chargeCurrency: 'USD',
    };

    expect(buildCartHash(input)).toBe(buildCartHash({
      ...input,
      offerIds: ['off_a', 'off_b'],
    }));
  });

  it('changes when the verified fare changes', () => {
    const base = {
      sessionId: 'session-1',
      bookingReference: 'pre_123',
      offerIds: ['off_a'],
      fareAmountCents: 120800,
      fareCurrency: 'USD',
      feeAmountCents: 2000,
      taxCents: 100,
      chargeAmountCents: 122900,
      chargeCurrency: 'USD',
    };

    expect(buildCartHash(base)).not.toBe(buildCartHash({
      ...base,
      fareAmountCents: 121000,
      chargeAmountCents: 123100,
    }));
  });
});
