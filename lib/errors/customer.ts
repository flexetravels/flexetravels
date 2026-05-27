const CUSTOMER_SAFE_BOOKING_ERRORS: Array<[RegExp, string]> = [
  [
    /DUFFEL_BALANCE_|insufficient_balance|balance/i,
    'We cannot complete online ticketing for this fare right now. If your card was charged, the charge will be reversed automatically. Please contact support or try again shortly.',
  ],
  [
    /PRICE_CHANGED|price has changed|fare changed/i,
    'The fare changed before ticketing. Please review the updated fare before continuing.',
  ],
  [
    /offer expired|offer.*no longer|expired/i,
    'This fare has expired. Please search again for fresh prices.',
  ],
  [
    /payment verification|tamper|metadata|PaymentIntent/i,
    'Payment verification failed. Please restart checkout or contact support.',
  ],
];

export function customerSafeBookingError(error: string | undefined | null): string {
  const raw = error ?? '';
  for (const [pattern, message] of CUSTOMER_SAFE_BOOKING_ERRORS) {
    if (pattern.test(raw)) return message;
  }
  return 'We could not complete the booking automatically. Please contact support and we will help finish this booking.';
}
