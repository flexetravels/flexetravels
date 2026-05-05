// Payment strategy router for supplier bookings.
//
// The checkout must not assume one universal money flow. Duffel Balance,
// Duffel Payments, Stripe, Razorpay, Amadeus, and Travelport all have different
// settlement paths. This module keeps the first decision explicit and testable:
// what does the customer pay now, who collects it, and what supplier rail pays
// the airline/hotel.

export type PaymentStrategy =
  | 'duffel_payments_markup'
  | 'stripe_balance'
  | 'razorpay_balance'
  | 'supplier_direct';

export type CheckoutMarket = 'CA' | 'US' | 'IN' | 'OTHER';

export interface MoneyInput {
  amount: number;
  currency: string;
}

export interface CheckoutQuoteInput {
  market?: CheckoutMarket;
  supplier?: 'duffel' | 'liteapi' | 'amadeus' | 'travelport' | 'mixed';
  flights: MoneyInput[];
  hotels?: MoneyInput[];
  serviceFeeAmount?: number;
  serviceFeeCurrency?: string;
  duffelPaymentsEnabled?: boolean;
  preferDuffelPayments?: boolean;
}

export interface CheckoutQuote {
  strategy: PaymentStrategy;
  supplier: string;
  fareSubtotal: number;
  fareCurrency: string;
  serviceFeeAmount: number;
  serviceFeeCurrency: string;
  chargeAmount: number;
  chargeCurrency: string;
  totalDisplayAmount: number;
  totalDisplayCurrency: string;
  chargedNowLabel: string;
  supplierPaymentLabel: string;
  caveats: string[];
}

const DEFAULT_SERVICE_FEE_AMOUNT = 20;
const DEFAULT_SERVICE_FEE_CURRENCY = 'USD';

function cleanCurrency(currency: string | undefined): string {
  return (currency || 'USD').trim().toUpperCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sameCurrency(items: MoneyInput[]): string | null {
  const currencies = Array.from(new Set(items.map(i => cleanCurrency(i.currency))));
  return currencies.length === 1 ? currencies[0] : null;
}

export function choosePaymentStrategy(input: CheckoutQuoteInput): PaymentStrategy {
  const market = input.market ?? 'CA';
  const supplier = input.supplier ?? 'duffel';

  if (supplier === 'duffel' && input.duffelPaymentsEnabled && input.preferDuffelPayments && market === 'US') {
    return 'duffel_payments_markup';
  }

  if (market === 'IN') return 'razorpay_balance';

  if (supplier === 'liteapi') return 'supplier_direct';

  return 'stripe_balance';
}

/**
 * Build the transparent customer-facing charge quote.
 *
 * Stripe/Razorpay balance modes collect the flight fare plus service fee up
 * front because FlexeTravels pays the supplier from balance after customer
 * payment. Supplier-direct mode collects only the service fee. Duffel Payments
 * collects fare + fee through Duffel's payment rail.
 */
export function buildCheckoutQuote(input: CheckoutQuoteInput): CheckoutQuote {
  const flights = input.flights ?? [];
  const hotels = input.hotels ?? [];
  const serviceFeeAmount = input.serviceFeeAmount ?? DEFAULT_SERVICE_FEE_AMOUNT;
  const serviceFeeCurrency = cleanCurrency(input.serviceFeeCurrency ?? DEFAULT_SERVICE_FEE_CURRENCY);
  const fareCurrency = sameCurrency(flights) ?? cleanCurrency(flights[0]?.currency ?? serviceFeeCurrency);
  const fareSubtotal = round2(flights.reduce((sum, f) => sum + Math.max(0, Number(f.amount) || 0), 0));
  const strategy = choosePaymentStrategy(input);
  const caveats: string[] = [];

  if (flights.length > 0 && !sameCurrency(flights)) {
    caveats.push('Flight fares are in mixed currencies; collect or book them as separate payment groups.');
  }

  if (hotels.length > 0) {
    const hotelCurrencies = Array.from(new Set(hotels.map(h => cleanCurrency(h.currency))));
    caveats.push(`Hotel charges are separate supplier charges${hotelCurrencies.length ? ` (${hotelCurrencies.join(' / ')})` : ''}.`);
  }

  if (strategy === 'stripe_balance' || strategy === 'razorpay_balance' || strategy === 'duffel_payments_markup') {
    if (fareCurrency !== serviceFeeCurrency) {
      caveats.push(`Service fee is ${serviceFeeCurrency}; fare is ${fareCurrency}. Convert fee before single-currency collection or show separate line items.`);
    }
    const chargeCurrency = fareCurrency;
    const feeInChargeCurrency = serviceFeeCurrency === chargeCurrency ? serviceFeeAmount : 0;
    const chargeAmount = round2(fareSubtotal + feeInChargeCurrency);
    return {
      strategy,
      supplier: input.supplier ?? 'duffel',
      fareSubtotal,
      fareCurrency,
      serviceFeeAmount,
      serviceFeeCurrency,
      chargeAmount,
      chargeCurrency,
      totalDisplayAmount: chargeAmount,
      totalDisplayCurrency: chargeCurrency,
      chargedNowLabel: strategy === 'duffel_payments_markup'
        ? 'Flight fare + FlexeTravels fee collected by Duffel Payments'
        : strategy === 'razorpay_balance'
          ? 'Flight fare + FlexeTravels fee collected by Razorpay'
          : 'Flight fare + FlexeTravels fee collected by Stripe',
      supplierPaymentLabel: 'FlexeTravels pays the airline from supplier balance after payment succeeds.',
      caveats,
    };
  }

  return {
    strategy,
    supplier: input.supplier ?? 'duffel',
    fareSubtotal,
    fareCurrency,
    serviceFeeAmount,
    serviceFeeCurrency,
    chargeAmount: serviceFeeAmount,
    chargeCurrency: serviceFeeCurrency,
    totalDisplayAmount: round2(fareSubtotal),
    totalDisplayCurrency: fareCurrency,
    chargedNowLabel: 'FlexeTravels service fee collected now',
    supplierPaymentLabel: 'Supplier collects the travel fare separately.',
    caveats,
  };
}

export function moneyToMinorUnits(amount: number): number {
  return Math.round(Math.max(0, Number(amount) || 0) * 100);
}
