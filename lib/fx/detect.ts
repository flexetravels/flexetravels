// ─── FX currency detection (client-safe) ───────────────────────────────────
// Maps navigator.language (or an explicit override) to a default currency code.
// Completely static — no network calls — so it's safe to run in React effects
// and layout.tsx without ballooning the first paint.

const LANGUAGE_TO_CURRENCY: Record<string, string> = {
  // Two-letter language → default currency
  en:    'USD',
  fr:    'EUR',
  de:    'EUR',
  es:    'EUR',
  it:    'EUR',
  pt:    'EUR',
  nl:    'EUR',
  sv:    'SEK',
  no:    'NOK',
  da:    'DKK',
  fi:    'EUR',
  pl:    'PLN',
  cs:    'CZK',
  hu:    'HUF',
  ro:    'RON',
  tr:    'TRY',
  ru:    'RUB',
  ja:    'JPY',
  ko:    'KRW',
  zh:    'CNY',
  hi:    'INR',
  ta:    'INR',
  te:    'INR',
  bn:    'INR',
  th:    'THB',
  vi:    'VND',
  id:    'IDR',
  ms:    'MYR',
  ar:    'AED',
  he:    'ILS',
  // Locale overrides — locale tag wins over language when present
};

const LOCALE_TO_CURRENCY: Record<string, string> = {
  'en-US': 'USD', 'en-CA': 'CAD', 'en-GB': 'GBP', 'en-AU': 'AUD',
  'en-NZ': 'NZD', 'en-IE': 'EUR', 'en-ZA': 'ZAR', 'en-IN': 'INR',
  'en-SG': 'SGD', 'en-HK': 'HKD', 'en-PH': 'PHP', 'en-AE': 'AED',
  'fr-CA': 'CAD', 'fr-CH': 'CHF', 'de-CH': 'CHF', 'de-AT': 'EUR',
  'es-MX': 'MXN', 'es-AR': 'ARS', 'es-CL': 'CLP', 'es-CO': 'COP',
  'es-PE': 'PEN', 'pt-BR': 'BRL',
};

/** Return a best-guess currency code (ISO 4217) from a BCP47 locale tag. */
export function currencyFromLocale(locale: string | undefined): string {
  if (!locale) return 'USD';
  const tag = locale.trim();
  if (LOCALE_TO_CURRENCY[tag]) return LOCALE_TO_CURRENCY[tag];
  const lang = tag.split(/[-_]/)[0]?.toLowerCase();
  if (lang && LANGUAGE_TO_CURRENCY[lang]) return LANGUAGE_TO_CURRENCY[lang];
  return 'USD';
}

/**
 * Client-only: detect the user's home currency from the browser.
 * Order of preference:
 *   1. localStorage `ft_home_currency` (explicit user choice)
 *   2. navigator.language / navigator.languages[0]
 *   3. 'USD' fallback
 */
export function detectHomeCurrency(): string {
  if (typeof window === 'undefined') return 'USD';
  try {
    const saved = window.localStorage.getItem('ft_home_currency');
    if (saved && /^[A-Z]{3}$/.test(saved)) return saved;
  } catch {
    /* localStorage unavailable (private mode) — ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const locale = nav?.language ?? nav?.languages?.[0];
  return currencyFromLocale(locale);
}

/** Common currencies shown in the picker — USD first, then most-used globally. */
export const COMMON_CURRENCIES: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'USD', symbol: '$',   label: 'US Dollar'         },
  { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar'   },
  { code: 'INR', symbol: '₹',   label: 'Indian Rupee'      },
  { code: 'EUR', symbol: '€',   label: 'Euro'              },
  { code: 'GBP', symbol: '£',   label: 'British Pound'     },
  { code: 'AUD', symbol: 'A$',  label: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥',   label: 'Japanese Yen'      },
  { code: 'SGD', symbol: 'S$',  label: 'Singapore Dollar'  },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham'        },
];
