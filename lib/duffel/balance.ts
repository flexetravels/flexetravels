export const DUFFEL_BALANCE_BUFFER_CENTS = Number.parseInt(
  process.env.DUFFEL_BALANCE_BUFFER_CENTS ?? '5000',
  10,
);

export interface DuffelBalanceCheck {
  ok: boolean;
  code?: 'DUFFEL_NOT_CONFIGURED' | 'DUFFEL_BALANCE_UNAVAILABLE' | 'DUFFEL_BALANCE_CURRENCY_MISMATCH' | 'DUFFEL_BALANCE_LOW';
  availableCents?: number;
  requiredCents?: number;
  currency?: string;
  message?: string;
}

function parseAmountCents(amount: string | undefined): number | null {
  if (!amount) return null;
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function customerSafeBalanceMessage(): string {
  return 'We cannot complete online ticketing for this fare right now. Your card has not been charged. Please contact support or try again shortly.';
}

export async function checkDuffelBalanceForFare({
  fareAmountCents,
  fareCurrency,
  bufferCents = DUFFEL_BALANCE_BUFFER_CENTS,
}: {
  fareAmountCents: number;
  fareCurrency: string;
  bufferCents?: number;
}): Promise<DuffelBalanceCheck> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, code: 'DUFFEL_NOT_CONFIGURED', message: 'DUFFEL_ACCESS_TOKEN is not configured' };
  }

  const res = await fetch('https://api.duffel.com/air/balance', {
    headers: {
      Authorization:    `Bearer ${token}`,
      'Duffel-Version': 'v2',
      Accept:           'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      code: 'DUFFEL_BALANCE_UNAVAILABLE',
      message: `Duffel balance check failed (${res.status}): ${detail.slice(0, 200)}`,
    };
  }

  const body = await res.json() as {
    data?: {
      available_balance?: string;
      currency?: string;
    };
  };
  const availableCents = parseAmountCents(body.data?.available_balance);
  const currency = (body.data?.currency ?? '').toUpperCase();
  const requiredCents = Math.max(0, fareAmountCents) + Math.max(0, bufferCents);
  const expectedCurrency = fareCurrency.toUpperCase();

  if (availableCents === null || !currency) {
    return {
      ok: false,
      code: 'DUFFEL_BALANCE_UNAVAILABLE',
      message: 'Duffel balance response missing available balance or currency',
    };
  }

  if (currency !== expectedCurrency) {
    return {
      ok: false,
      code: 'DUFFEL_BALANCE_CURRENCY_MISMATCH',
      availableCents,
      requiredCents,
      currency,
      message: `Duffel balance is ${currency}, fare is ${expectedCurrency}`,
    };
  }

  if (availableCents < requiredCents) {
    return {
      ok: false,
      code: 'DUFFEL_BALANCE_LOW',
      availableCents,
      requiredCents,
      currency,
      message: `Duffel balance ${availableCents} ${currency} is below required ${requiredCents} ${currency}`,
    };
  }

  return {
    ok: true,
    availableCents,
    requiredCents,
    currency,
  };
}
