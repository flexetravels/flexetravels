import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const getPaymentIntent = vi.fn();
const refundPaymentIntent = vi.fn(async () => ({ id: 're_test_123', status: 'succeeded' }));
const book = vi.fn();
const getOrCreatePaymentTransaction = vi.fn(async () => ({ id: 'pt_test_123' }));
const hasConfirmedSupplierBooking = vi.fn(async () => false);
const recordSupplierBookingAndLedger = vi.fn(async () => undefined);

vi.mock('@/lib/stripe', () => ({
  getPaymentIntent,
  refundPaymentIntent,
}));

vi.mock('@/lib/orchestrator', () => ({
  book,
}));

vi.mock('@/lib/payments/ledger', () => ({
  getOrCreatePaymentTransaction,
  hasConfirmedSupplierBooking,
  recordSupplierBookingAndLedger,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    userSessions: { incrementBookings: vi.fn(async () => undefined) },
    searchLogs: { markConvertedForSession: vi.fn(async () => undefined) },
    passengers: { insertMany: vi.fn(async () => undefined) },
  },
}));

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session_book_123',
    paymentIntentId: 'pi_test_123',
    flightOfferId: 'off_paid_123',
    requestedPriceCents: 120000,
    passengers: [{
      firstName: 'Test',
      lastName: 'Traveller',
      dateOfBirth: '1980-01-02',
      email: 'customer@example.com',
      phone: '+16045551234',
      gender: 'm',
    }],
    ...overrides,
  };
}

async function postBookTrip(body = requestBody()) {
  const { POST } = await import('@/app/api/book-trip/route');
  return POST(new Request('http://localhost/api/book-trip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

afterEach(() => {
  process.env = { ...originalEnv };
  getPaymentIntent.mockReset();
  refundPaymentIntent.mockClear();
  book.mockReset();
  getOrCreatePaymentTransaction.mockClear();
  hasConfirmedSupplierBooking.mockClear();
  recordSupplierBookingAndLedger.mockClear();
  vi.resetModules();
});

describe('/api/book-trip payment guards', () => {
  it('rejects PaymentIntent metadata flight-offer mismatch before supplier booking', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    getPaymentIntent.mockResolvedValue({
      id: 'pi_test_123',
      status: 'succeeded',
      amount: 122100,
      currency: 'usd',
      metadata: {
        expected_amount: '122100',
        flight_offer_id: 'off_paid_123',
        flight_price_cents: '120000',
        service_fee_cents: '2000',
        service_fee_tax_cents: '100',
        payment_quote_id: 'quote_test_123',
      },
    });

    const res = await postBookTrip(requestBody({ flightOfferId: 'off_attacker_swap' }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe('Payment verification failed');
    expect(book).not.toHaveBeenCalled();
  });

  it('rejects duplicate concurrent booking attempts for the same PaymentIntent', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    getPaymentIntent.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return {
        id: 'pi_test_123',
        status: 'succeeded',
        amount: 122100,
        currency: 'usd',
        metadata: {
          expected_amount: '122100',
          flight_offer_id: 'off_paid_123',
          flight_price_cents: '120000',
          service_fee_cents: '2000',
          service_fee_tax_cents: '100',
          payment_quote_id: 'quote_test_123',
        },
      };
    });
    book.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        flightRef: 'PNR123',
        tripId: 'trip_test_123',
      },
    });

    const [first, second] = await Promise.all([
      postBookTrip(),
      postBookTrip(),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(book).toHaveBeenCalledTimes(1);
    const duplicate = first.status === 409 ? first : second;
    const duplicateBody = await duplicate.json();
    expect(duplicateBody.error).toMatch(/already in progress/i);
  });
});
