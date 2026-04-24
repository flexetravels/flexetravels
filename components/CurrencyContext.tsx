'use client';

// ─── Currency Context ───────────────────────────────────────────────────────
// Exposes the user's home currency + USD→* rates to any component via
// `useCurrency()`. Rates come from /api/fx (cached 24h server-side).
// Home currency defaults to navigator.language → ISO-4217, overridable by
// the picker and persisted in localStorage.

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { detectHomeCurrency } from '@/lib/fx/detect';
import type { FxRates } from '@/lib/fx/rates';

interface CurrencyContextValue {
  homeCurrency: string;
  setHomeCurrency: (code: string) => void;
  rates: Record<string, number> | null;  // USD→* map, or null while loading
  ratesDate: string | null;              // upstream date stamp, informational
  ratesLoading: boolean;
  /** Convert an amount from `fromCurrency` to the user's home currency. */
  convert: (amount: number, fromCurrency: string, toCurrency?: string) => number | null;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [homeCurrency, setHomeCurrencyState] = useState<string>('USD');
  const [rates, setRates]           = useState<Record<string, number> | null>(null);
  const [ratesDate, setRatesDate]   = useState<string | null>(null);
  const [ratesLoading, setLoading]  = useState(true);

  // Initial home currency detection (runs only in the browser)
  useEffect(() => {
    setHomeCurrencyState(detectHomeCurrency());
  }, []);

  // One-shot fetch of rates on mount. No polling — daily data doesn't change.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/fx', { cache: 'force-cache' });
        if (!res.ok) throw new Error(`fx HTTP ${res.status}`);
        const body = await res.json() as FxRates;
        if (!alive) return;
        setRates(body.rates ?? null);
        setRatesDate(body.date ?? null);
      } catch (err) {
        console.warn('[CurrencyProvider] /api/fx fetch failed:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const setHomeCurrency = useCallback((code: string) => {
    const normalized = code?.toUpperCase();
    if (!normalized || !/^[A-Z]{3}$/.test(normalized)) return;
    setHomeCurrencyState(normalized);
    try {
      window.localStorage.setItem('ft_home_currency', normalized);
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, []);

  const convert = useCallback(
    (amount: number, fromCurrency: string, toCurrency?: string): number | null => {
      if (!rates) return null;
      const from = (fromCurrency || 'USD').toUpperCase();
      const to   = (toCurrency   || homeCurrency).toUpperCase();
      if (from === to) return amount;
      const fromRate = rates[from];   // USD → from
      const toRate   = rates[to];     // USD → to
      if (!fromRate || !toRate) return null;
      // amount is in `from`, convert to USD then to `to`
      const usd = amount / fromRate;
      return usd * toRate;
    },
    [rates, homeCurrency],
  );

  const value = useMemo<CurrencyContextValue>(() => ({
    homeCurrency,
    setHomeCurrency,
    rates,
    ratesDate,
    ratesLoading,
    convert,
  }), [homeCurrency, setHomeCurrency, rates, ratesDate, ratesLoading, convert]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * Access the user's home currency and FX rates.
 * Safe to call in any component — returns a no-op object when the provider
 * isn't mounted (e.g. in Storybook/tests) so callers don't need null checks.
 */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (ctx) return ctx;
  // Fallback for components rendered outside the provider — display charge
  // currency only, no conversions.
  return {
    homeCurrency: 'USD',
    setHomeCurrency: () => {},
    rates: null,
    ratesDate: null,
    ratesLoading: false,
    convert: () => null,
  };
}
