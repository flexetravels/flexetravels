import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const createPaymentIntent = vi.fn(async () => ({
  clientSecret: 'pi_secret_test',
  paymentIntentId: 'pi_test_123',
  amount: 123600,
  currency: 'usd',
}));
const createPaymentQuoteRecord = vi.fn(async () => ({ id: 'quote_test_123' }));

vi.mock('@/lib/stripe', () => ({ createPaymentIntent }));
vi.mock('@/lib/payments/ledger', () => ({ createPaymentQuoteRecord }));

function mockDuffelFetch(price = '1215.00', currency = 'USD') {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/air/offers/')) {
      return new Response(JSON.stringify({
        data: { total_amount: price, total_currency: currency },
      }), { status: 200 });
    }
    if (url.includes('/air/balance')) {
      return new Response(JSON.stringify({
        data: { available_balance: '5000.00', currency },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
}

afterEach(() => {
  process.env = { ...originalEnv };
  createPaymentIntent.mockClear();
  createPaymentQuoteRecord.mockClear();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('/api/stripe/prepare', () => {
  it('creates a PaymentIntent from server-verified Duffel fare plus fee and service-fee tax', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_123';
    mockDuffelFetch('1215.00', 'USD');

    const { POST } = await import('@/app/api/stripe/prepare/route');
    const res = await POST(new Request('http://localhost/api/stripe/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session_prepare_123',
        bookingReference: 'FT-TEST',
        customerEmail: 'customer@example.com',
        flightOfferId: 'off_live_123',
        flightPriceCents: 121500,
        flightCurrency: 'USD',
        flightDescription: 'BLR -> YVR Cathay Pacific',
        passengerCount: 1,
        billingCountry: 'CA',
        billingRegion: 'BC',
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(createPaymentQuoteRecord).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session_prepare_123',
      bookingReference: 'FT-TEST',
      flightOfferId: 'off_live_123',
      fareAmountCents: 121500,
      feeAmountCents: 2000,
      taxCents: 100,
      chargeAmountCents: 123600,
    }));
    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      amount: 123600,
      currency: 'usd',
      customerEmail: 'customer@example.com',
      metadata: expect.objectContaining({
        expected_amount: '123600',
        flight_offer_id: 'off_live_123',
        flight_price_cents: '121500',
        service_fee_cents: '2000',
        service_fee_tax_cents: '100',
        payment_quote_id: 'quote_test_123',
      }),
    }));
    expect(body.breakdown).toMatchObject({
      flightCents: 121500,
      serviceFeeCents: 2000,
      serviceFeeTaxCents: 100,
      totalCents: 123600,
      currency: 'USD',
    });
  });

  it('blocks silent checkout when verified Duffel fare differs from displayed fare', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_123';
    mockDuffelFetch('1300.00', 'USD');

    const { POST } = await import('@/app/api/stripe/prepare/route');
    const res = await POST(new Request('http://localhost/api/stripe/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingReference: 'FT-CHANGED',
        flightOfferId: 'off_changed_123',
        flightPriceCents: 121500,
        flightCurrency: 'USD',
        billingCountry: 'CA',
        billingRegion: 'BC',
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('FLIGHT_PRICE_CHANGED');
    expect(body.verifiedFlightPriceCents).toBe(130000);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });
});
