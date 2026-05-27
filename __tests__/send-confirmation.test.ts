import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function bookingPayload(overrides: Record<string, unknown> = {}) {
  return {
    paymentIntentId: 'pi_test_123',
    sessionId: 'session_test_123',
    flightRef: 'PNR123',
    passengers: [{
      firstName: '<script>alert(1)</script>',
      lastName: 'Traveller',
      dateOfBirth: '1980-01-02',
      email: 'customer@example.com',
      phone: '+16045551234',
    }],
    adults: 1,
    children: 0,
    currency: 'USD',
    serviceFee: 20,
    serviceFeeTax: 1,
    serviceFeeTaxLabel: 'GST on service fee',
    flight: {
      airline: 'Cathay Pacific',
      origin: 'BLR',
      destination: 'YVR',
      departure: '2026-06-19T01:15:00.000Z',
      arrival: '2026-06-19T20:10:00.000Z',
      duration: '19h 25m',
      stops: 1,
      price: 1201,
      currency: 'USD',
      cabinClass: 'premium_economy',
      fareBrandName: 'Premium Economy Essential',
      fareTermsDetails: {
        displayName: 'Premium Economy Essential',
        customerLabel: 'Lowest available Premium Economy fare',
        bestFor: 'Travellers with firm plans who want the lowest price',
        confidenceLabel: 'Based on airline fare-family guidance',
        changeTerms: {
          simpleSummary: 'Changes may be restricted and fare difference may apply.',
          uiLabel: 'Ticket rules apply',
        },
        refundTerms: {
          simpleSummary: 'Cancellation fee may apply. Refund amount depends on ticket rules.',
          uiLabel: 'Ticket rules apply',
        },
        checkoutDisclaimer: 'Exact fees and refund amounts are governed by final airline ticket rules.',
      },
      segments: [{
        origin: 'BLR',
        destination: 'HKG',
        departure: '2026-06-19T01:15:00.000Z',
        arrival: '2026-06-19T09:50:00.000Z',
        duration: '5h 5m',
        carrier: 'Cathay Pacific',
        flightNumber: 'CX624',
      }],
    },
    ...overrides,
  };
}

async function importRouteWithMocks(sendMail = vi.fn(async () => ({ messageId: 'msg_123' }))) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-pass',
    SMTP_FROM: 'FlexeTravels <bookings@flexetravels.com>',
  };

  vi.doMock('nodemailer', () => ({
    default: {
      createTransport: vi.fn(() => ({ sendMail })),
    },
    createTransport: vi.fn(() => ({ sendMail })),
  }));

  vi.doMock('@/lib/db/client', () => ({
    DB_AVAILABLE: true,
    db: {
      payments: {
        getByIntentId: vi.fn(async () => ({
          booking_ref: 'PNR123',
          stripe_intent_id: 'pi_test_123',
        })),
      },
      bookings: {
        getByBookingRef: vi.fn(async () => ({
          provider: 'duffel',
          status: 'confirmed',
          booking_ref: 'PNR123',
        })),
      },
      trips: {
        get: vi.fn(),
      },
    },
  }));

  const route = await import('@/app/api/send-confirmation/route');
  return { POST: route.POST as (req: Request) => Promise<Response>, sendMail };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe('/api/send-confirmation', () => {
  it('sends the confirmation to the lead passenger with references, totals, and escaped HTML', async () => {
    const { POST, sendMail } = await importRouteWithMocks();

    const res = await POST(new Request('http://localhost/api/send-confirmation', {
      method: 'POST',
      body: JSON.stringify(bookingPayload()),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(sendMail).toHaveBeenCalledTimes(1);

    const message = sendMail.mock.calls[0][0];
    expect(message.from).toBe('FlexeTravels <bookings@flexetravels.com>');
    expect(message.to).toBe('customer@example.com');
    expect(message.subject).toBe('Flight Booking Confirmed — PNR123');
    expect(message.html).toContain('PNR123');
    expect(message.html).toContain('Cathay Pacific');
    expect(message.html).toContain('GST on service fee');
    expect(message.html).toContain('Premium Economy Essential');
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).not.toContain('<script>alert(1)</script>');
  });

  it('does not send email when the booking cannot be verified', async () => {
    const sendMail = vi.fn();
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'smtp-user',
      SMTP_PASS: 'smtp-pass',
    };
    vi.doMock('nodemailer', () => ({
      default: { createTransport: vi.fn(() => ({ sendMail })) },
      createTransport: vi.fn(() => ({ sendMail })),
    }));
    vi.doMock('@/lib/db/client', () => ({
      DB_AVAILABLE: true,
      db: {
        payments: { getByIntentId: vi.fn(async () => null) },
        bookings: { getByBookingRef: vi.fn(async () => null) },
        trips: { get: vi.fn() },
      },
    }));

    const { POST } = await import('@/app/api/send-confirmation/route');
    const res = await POST(new Request('http://localhost/api/send-confirmation', {
      method: 'POST',
      body: JSON.stringify(bookingPayload()),
    }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('No verified booking found');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
