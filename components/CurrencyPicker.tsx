'use client';

// ─── Currency Picker ────────────────────────────────────────────────────────
// Small dropdown allowing the user to change their display currency.
// Affects any component that uses useCurrency() — flight & hotel cards,
// checkout invoice totals.

import { useCurrency } from './CurrencyContext';
import { COMMON_CURRENCIES } from '@/lib/fx/detect';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CurrencyPickerProps {
  className?: string;
}

export function CurrencyPicker({ className }: CurrencyPickerProps) {
  const { homeCurrency, setHomeCurrency, ratesLoading } = useCurrency();

  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        value={homeCurrency}
        onChange={e => setHomeCurrency(e.target.value)}
        disabled={ratesLoading}
        aria-label="Display currency"
        title="Display currency — prices stay in their charge currency; this adds a converted estimate alongside."
        className="appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs font-semibold
                   bg-muted text-muted-foreground border-0 cursor-pointer
                   focus:outline-none focus:ring-1 focus:ring-teal-400
                   disabled:opacity-50 disabled:cursor-wait"
      >
        {COMMON_CURRENCIES.map(c => (
          <option key={c.code} value={c.code}>{c.code}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}
