// ─── FX rates (server) ─────────────────────────────────────────────────────
// Fetches daily USD→* rates from frankfurter.app (ECB data, free, no API key).
// In-memory cache with 24h TTL. Falls back to a hard-coded snapshot if the
// upstream is unreachable so the UI never hard-fails for want of exchange rates.

export interface FxRates {
  base: 'USD';
  date: string;                     // ISO yyyy-mm-dd
  rates: Record<string, number>;    // target currency code → rate (1 USD = N target)
  stale?: boolean;                  // true when served from fallback snapshot
}

// Hard-coded snapshot (updated sporadically). Used when the network fetch
// fails so converted prices still render approximately rather than vanishing.
const FALLBACK_RATES: FxRates = {
  base: 'USD',
  date: '2026-04-01',
  stale: true,
  rates: {
    USD: 1,     EUR: 0.92,  GBP: 0.79,  CAD: 1.37,  AUD: 1.51,
    NZD: 1.65,  INR: 83.4,  JPY: 149.8, CNY: 7.19,  HKD: 7.82,
    SGD: 1.34,  KRW: 1340,  THB: 35.6,  MYR: 4.71,  IDR: 15800,
    PHP: 56.3,  VND: 24500, AED: 3.67,  SAR: 3.75,  ILS: 3.72,
    TRY: 32.1,  EGP: 48.2,  ZAR: 18.4,  NGN: 1550,  KES: 130,
    BRL: 5.12,  ARS: 875,   CLP: 950,   MXN: 17.1,  COP: 3900,
    PEN: 3.72,  CHF: 0.88,  SEK: 10.6,  NOK: 10.8,  DKK: 6.88,
    PLN: 3.98,  CZK: 23.1,  HUF: 361,   RON: 4.56,  BGN: 1.80,
  },
};

let cache: { value: FxRates; fetchedAt: number } | null = null;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Get the current USD→* rates. Cached in-process for 24h.
 * Returns the fallback snapshot if upstream is unreachable.
 */
export async function getRates(): Promise<FxRates> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.value;
  }

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD', {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' },
      cache:   'no-store',
    });
    if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
    const json = await res.json() as { amount?: number; base?: string; date?: string; rates?: Record<string, number> };
    if (!json?.rates || json.base !== 'USD') throw new Error('frankfurter: unexpected payload');

    const value: FxRates = {
      base:  'USD',
      date:  json.date ?? new Date().toISOString().slice(0, 10),
      rates: { USD: 1, ...json.rates },
    };
    cache = { value, fetchedAt: Date.now() };
    return value;
  } catch (err) {
    console.warn('[fx] frankfurter fetch failed — using fallback snapshot:', String(err));
    // Don't cache the fallback — we want to retry on next request
    return FALLBACK_RATES;
  }
}
