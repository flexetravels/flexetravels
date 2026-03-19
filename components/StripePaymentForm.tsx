'use client';

/**
 * StripePaymentForm — Embedded $20 FlexeTravels service fee payment.
 *
 * Loads Stripe.js directly from https://js.stripe.com/v3/ (no npm package needed).
 * Creates a PaymentIntent via /api/stripe/create-payment-intent, mounts
 * Stripe's PaymentElement inside the chat window, and confirms payment in-page.
 * Uses redirect:'if_required' so card payments complete without leaving the chat.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, Lock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Minimal Stripe.js type shim (no npm package required) ───────────────────

interface StripePaymentElementOptions {
  layout?: 'tabs' | 'accordion';
}

interface StripePaymentElement {
  mount(selector: string | HTMLElement): void;
  unmount(): void;
  on(event: string, handler: (e: { complete: boolean }) => void): void;
  destroy(): void;
}

interface StripeElements {
  create(type: 'payment', options?: StripePaymentElementOptions): StripePaymentElement;
  submit(): Promise<{ error?: { message: string } }>;
}

interface StripeConfirmResult {
  error?: { message: string };
  paymentIntent?: { id: string; status: string };
}

interface StripeInstance {
  elements(options: {
    clientSecret: string;
    appearance?: Record<string, unknown>;
    locale?: string;
  }): StripeElements;
  confirmPayment(options: {
    elements:      StripeElements;
    confirmParams: { return_url: string };
    redirect:      'if_required' | 'always';
  }): Promise<StripeConfirmResult>;
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PaymentRequiredData {
  bookingReference: string;
  bookingType:      'flight' | 'hotel';
  customerEmail?:   string;
  amount?:          number;   // cents — defaults to 2000
  currency?:        string;   // defaults to 'usd'
}

interface StripePaymentFormProps {
  data: PaymentRequiredData;
}

// ─── Stripe.js loader ─────────────────────────────────────────────────────────

let stripeJsPromise: Promise<StripeInstance | null> | null = null;

function loadStripeJs(publishableKey: string): Promise<StripeInstance | null> {
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve) => {
    // If already loaded
    if (window.Stripe) { resolve(window.Stripe(publishableKey)); return; }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => {
      resolve(window.Stripe ? window.Stripe(publishableKey) : null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}

// ─── Appearance theme ─────────────────────────────────────────────────────────

function buildAppearance(isDark: boolean) {
  return {
    theme: isDark ? 'night' : 'stripe',
    variables: {
      colorPrimary:       '#0d9488',   // teal-600
      colorBackground:    isDark ? '#1e293b' : '#ffffff',
      colorText:          isDark ? '#f1f5f9' : '#0f172a',
      colorDanger:        '#ef4444',
      fontFamily:         'system-ui, sans-serif',
      borderRadius:       '8px',
      spacingUnit:        '4px',
    },
    rules: {
      '.Input': {
        border:      isDark ? '1px solid #334155' : '1px solid #e2e8f0',
        boxShadow:   'none',
        padding:     '10px 12px',
      },
      '.Input:focus': {
        border:    '1px solid #0d9488',
        boxShadow: '0 0 0 2px rgba(13,148,136,0.2)',
      },
      '.Label': {
        fontWeight: '500',
        fontSize:   '0.8125rem',
      },
    },
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'ready' | 'submitting' | 'success' | 'error';

export function StripePaymentForm({ data }: StripePaymentFormProps) {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  const [phase,   setPhase]   = useState<Phase>('idle');
  const [errMsg,  setErrMsg]  = useState<string>('');
  const [complete, setComplete] = useState(false);   // payment element filled?

  const stripeRef   = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const mountRef    = useRef<StripePaymentElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const amountCents = data.amount   ?? 2000;
  const currency    = (data.currency ?? 'usd').toUpperCase();
  const amountDisplay = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === 'USD' ? 'USD' : currency,
  }).format(amountCents / 100);

  // Detect dark mode
  const isDark = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark')
    : false;

  const initStripe = useCallback(async () => {
    if (!publishableKey) {
      setErrMsg('Payment not configured. Please contact support.');
      setPhase('error');
      return;
    }

    setPhase('loading');
    setErrMsg('');

    try {
      // 1. Create PaymentIntent on server
      const piRes = await fetch('/api/stripe/create-payment-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingReference: data.bookingReference,
          bookingType:      data.bookingType,
          customerEmail:    data.customerEmail,
        }),
      });

      if (!piRes.ok) {
        const err = await piRes.json() as { error?: string };
        throw new Error(err.error ?? `Server error ${piRes.status}`);
      }

      const { clientSecret } = await piRes.json() as { clientSecret: string };

      // 2. Load Stripe.js from CDN
      const stripe = await loadStripeJs(publishableKey);
      if (!stripe) throw new Error('Failed to load Stripe.js. Check your connection.');
      stripeRef.current = stripe;

      // 3. Create Elements with Payment Element
      const elements = stripe.elements({
        clientSecret,
        appearance: buildAppearance(isDark) as Record<string, unknown>,
      });
      elementsRef.current = elements;

      // 4. Create and mount the Payment Element
      const paymentEl = elements.create('payment', { layout: 'tabs' });
      mountRef.current = paymentEl;

      // Track completion state
      paymentEl.on('change', (e) => setComplete(e.complete));

      setPhase('ready');

      // Mount after state update (container must be rendered)
      setTimeout(() => {
        if (containerRef.current) {
          paymentEl.mount(containerRef.current);
        }
      }, 50);

    } catch (err) {
      setErrMsg(String(err));
      setPhase('error');
    }
  }, [publishableKey, data.bookingReference, data.bookingType, data.customerEmail, isDark]);

  // Auto-init on mount
  useEffect(() => {
    initStripe();
    return () => {
      mountRef.current?.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setPhase('submitting');
    setErrMsg('');

    try {
      // Submit the elements (triggers validation)
      const { error: submitError } = await elementsRef.current.submit();
      if (submitError) {
        setErrMsg(submitError.message);
        setPhase('ready');
        return;
      }

      // Confirm the payment — redirect:'if_required' keeps the user on-page
      const result = await stripeRef.current.confirmPayment({
        elements:      elementsRef.current,
        confirmParams: {
          return_url: `${window.location.origin}/booking?ref=${data.bookingReference}&fee_paid=true`,
        },
        redirect: 'if_required',
      });

      if (result.error) {
        setErrMsg(result.error.message);
        setPhase('ready');
      } else {
        // Payment completed in-page (no redirect)
        setPhase('success');
        mountRef.current?.unmount();
      }
    } catch (err) {
      setErrMsg(String(err));
      setPhase('ready');
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="travel-card p-4 border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <span className="font-bold text-teal-700 dark:text-teal-300">Payment Confirmed!</span>
        </div>
        <p className="text-sm text-teal-700 dark:text-teal-300">
          Your {amountDisplay} FlexeTravels service fee has been processed. Check your email for a receipt.
        </p>
        <p className="text-xs text-teal-600/70 dark:text-teal-400/70 mt-1">
          Booking reference: <code className="font-mono font-bold">{data.bookingReference}</code>
        </p>
      </div>
    );
  }

  // ── Main card ──────────────────────────────────────────────────────────────
  return (
    <div className="travel-card overflow-hidden border border-border">
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-4 py-3 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-white" />
        <span className="text-white font-semibold text-sm">FlexeTravels Service Fee</span>
        <span className="ml-auto text-white font-bold text-base">{amountDisplay}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Context */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>
            <span className="font-medium text-foreground">{data.bookingType === 'flight' ? '✈ Flight' : '🏨 Hotel'} booking confirmed</span>
            {' '}— one-time service fee to complete your reservation.
          </p>
          <p className="flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" /> Secured by Stripe · No card details stored by FlexeTravels
          </p>
          <p className="font-mono text-[10px] opacity-60">Ref: {data.bookingReference}</p>
        </div>

        {/* Payment Element mount point */}
        {phase === 'loading' && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading secure payment form…
          </div>
        )}

        {phase === 'error' && errMsg && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-700 dark:text-red-300">
              <p className="font-medium">Payment unavailable</p>
              <p className="opacity-80 mt-0.5">{errMsg}</p>
            </div>
          </div>
        )}

        {/* Stripe Payment Element renders here */}
        <div
          ref={containerRef}
          className={cn(
            'min-h-[120px] transition-all',
            (phase === 'loading' || phase === 'idle') && 'hidden'
          )}
        />

        {/* Error from submission */}
        {(phase === 'ready' || phase === 'submitting') && errMsg && (
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {errMsg}
          </div>
        )}

        {/* Pay button */}
        {(phase === 'ready' || phase === 'submitting') && (
          <button
            onClick={handleSubmit}
            disabled={phase === 'submitting' || !complete}
            className={cn(
              'w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all',
              'bg-teal-600 text-white hover:bg-teal-700',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {phase === 'submitting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                Pay {amountDisplay} securely
              </>
            )}
          </button>
        )}

        {/* Stripe badge */}
        {(phase === 'ready' || phase === 'submitting') && (
          <p className="text-center text-[10px] text-muted-foreground/60">
            Powered by <span className="font-semibold text-muted-foreground">Stripe</span> · PCI-DSS compliant
          </p>
        )}
      </div>
    </div>
  );
}
