// ─── Stripe REST Client (no SDK) ──────────────────────────────────────────────
// Calls Stripe API directly using fetch + URL-encoded form body (Stripe standard)
// Docs: https://stripe.com/docs/api

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** Encode nested object to URL-encoded string (Stripe format) */
function encode(obj: Record<string, unknown>, prefix = ''): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && !Array.isArray(v)) {
        return encode(v as Record<string, unknown>, key);
      }
      if (Array.isArray(v)) {
        return v.map((item, i) =>
          typeof item === 'object'
            ? encode(item as Record<string, unknown>, `${key}[${i}]`)
            : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`
        ).join('&');
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`;
    })
    .filter(Boolean)
    .join('&');
}

interface StripeCheckoutSession {
  id: string;
  url: string;
  payment_status: string;
  status: string;
}

interface StripeCheckoutParams {
  bookingReference: string;
  flightDescription: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Create a Stripe Checkout session for the $20 FlexeTravels service fee.
 * Returns the checkout URL to redirect the user to.
 */
export async function createServiceFeeCheckout(params: StripeCheckoutParams): Promise<{ url: string; sessionId: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.trim() === '') {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const body: Record<string, unknown> = {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 2000, // $20.00 in cents
          product_data: {
            name: 'FlexeTravels Service Fee',
            description: `Booking facilitation for ${params.flightDescription}. Ref: ${params.bookingReference}`,
          },
        },
      },
    ],
    success_url: params.successUrl,
    cancel_url:  params.cancelUrl,
    metadata: {
      booking_reference: params.bookingReference,
      service: 'flexetravels_booking_fee',
    },
  };

  if (params.customerEmail) {
    body.customer_email = params.customerEmail;
  }

  const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encode(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Stripe error: ${err.error?.message ?? 'Unknown error'}`);
  }

  const session = await res.json() as StripeCheckoutSession;
  return { url: session.url, sessionId: session.id };
}

// ─── Payment Intent (for embedded in-chat payment form) ──────────────────────

export interface PaymentIntentResult {
  clientSecret:    string;
  paymentIntentId: string;
  amount:          number;   // in cents
  currency:        string;
}

/**
 * Create a Stripe PaymentIntent for the $20 FlexeTravels service fee.
 * Returns the clientSecret used by Stripe.js on the client.
 */
export async function createPaymentIntent(params: {
  bookingReference: string;
  bookingType:      'flight' | 'hotel';
  customerEmail?:   string;
  amount?:          number;   // cents — defaults to 2000 ($20.00)
  currency?:        string;   // defaults to 'usd'
}): Promise<PaymentIntentResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || secretKey.trim() === '') {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const amount   = params.amount   ?? 2000;   // $20.00 USD
  const currency = params.currency ?? 'usd';

  const body: Record<string, unknown> = {
    amount,
    currency,
    payment_method_types: ['card'],
    description: `FlexeTravels service fee — ${params.bookingType} booking (ref: ${params.bookingReference})`,
    metadata: {
      booking_reference: params.bookingReference,
      booking_type:      params.bookingType,
      service:           'flexetravels_booking_fee',
    },
  };

  if (params.customerEmail) {
    body.receipt_email = params.customerEmail;
  }

  const res = await fetch(`${STRIPE_BASE}/payment_intents`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encode(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Stripe PaymentIntent error: ${err.error?.message ?? 'Unknown error'}`);
  }

  const intent = await res.json() as {
    id: string;
    client_secret: string;
    amount: number;
    currency: string;
  };

  return {
    clientSecret:    intent.client_secret,
    paymentIntentId: intent.id,
    amount:          intent.amount,
    currency:        intent.currency,
  };
}

/**
 * Retrieve a Stripe Checkout session to verify payment status.
 */
export async function getCheckoutSession(sessionId: string): Promise<StripeCheckoutSession> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Stripe not configured');

  const res = await fetch(`${STRIPE_BASE}/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Stripe session fetch failed: ${res.status}`);
  return res.json() as Promise<StripeCheckoutSession>;
}

/**
 * Verify Stripe webhook signature (basic HMAC-SHA256 check).
 * Returns true if valid.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // Stripe-Signature: t=<timestamp>,v1=<sig1>,v1=<sig2>...
  const parts = Object.fromEntries(
    signature.split(',').map(p => p.split('=') as [string, string])
  );
  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return false;

  // HMAC-SHA256(timestamp.payload, secret)
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const hexSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Timing-safe comparison
  if (hexSig.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hexSig.length; i++) {
    mismatch |= hexSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}
