'use client';

/**
 * CheckoutCard — Apple/Tesla-inspired 3-step checkout.
 * Step 1: Review trip summary + set passenger count
 * Step 2: Passenger details (one clean form per passenger)
 * Step 3: Stripe payment for the $20 service fee
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plane, Building2, User, Plus, Minus,
  CheckCircle2, AlertCircle, Loader2, Lock, X, ArrowRight, ArrowLeft,
} from 'lucide-react';
import { cn, formatPrice, formatDate } from '@/lib/utils';
import type { FlightResult, HotelResult } from '@/lib/types';

// ─── Stripe CDN loader ─────────────────────────────────────────────────────────

interface StripePaymentElement {
  mount(el: HTMLElement): void;
  unmount(): void;
  on(event: string, handler: (e: { complete: boolean }) => void): void;
  destroy(): void;
}
interface StripeElements {
  create(type: 'payment', opts?: { layout?: string }): StripePaymentElement;
  submit(): Promise<{ error?: { message: string } }>;
}
interface StripeInstance {
  elements(opts: { clientSecret: string; appearance?: unknown }): StripeElements;
  confirmPayment(opts: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: 'if_required' | 'always';
  }): Promise<{ error?: { message: string }; paymentIntent?: { status: string } }>;
}
type StripeCtor = (publishableKey: string) => StripeInstance;

let _stripePromise: Promise<StripeInstance | null> | null = null;
function loadStripe(pk: string): Promise<StripeInstance | null> {
  if (_stripePromise) return _stripePromise;
  _stripePromise = new Promise(resolve => {
    const ctor = (window as unknown as { Stripe?: StripeCtor }).Stripe;
    if (ctor) return resolve(ctor(pk));
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => {
      const c = (window as unknown as { Stripe?: StripeCtor }).Stripe;
      resolve(c ? c(pk) : null);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _stripePromise;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Passenger {
  firstName:   string;
  lastName:    string;
  dateOfBirth: string;   // YYYY-MM-DD
  email:       string;
  phone:       string;
}

const blankPassenger = (): Passenger => ({
  firstName: '', lastName: '', dateOfBirth: '', email: '', phone: '',
});

interface CheckoutCardProps {
  flight:      FlightResult | null;
  hotel:       HotelResult  | null;
  onClose:     () => void;
  onConfirmed?: (flightRef?: string, hotelRef?: string) => void;
}

type Phase = 'review' | 'passengers' | 'booking' | 'payment' | 'success' | 'error';

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Review', 'Passengers', 'Pay'] as const;
type StepLabel = typeof STEPS[number];

function phaseToStep(phase: Phase): number {
  if (phase === 'review')                  return 0;
  if (phase === 'passengers')              return 1;
  if (phase === 'booking' || phase === 'payment') return 2;
  return 2;
}

function StepDots({ phase }: { phase: Phase }) {
  const active = phaseToStep(phase);
  return (
    <div className="flex items-center justify-center gap-0 mb-5">
      {STEPS.map((label: StepLabel, i: number) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300',
              i < active  ? 'bg-teal-600 text-white' :
              i === active ? 'bg-teal-600 text-white shadow-md shadow-teal-500/30 scale-110' :
                            'bg-muted text-muted-foreground'
            )}>
              {i < active ? '✓' : i + 1}
            </div>
            <span className={cn(
              'text-[9px] uppercase tracking-wider font-semibold transition-colors',
              i === active ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/50'
            )}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn(
              'h-px w-10 mx-1 mb-4 transition-colors duration-300',
              i < active ? 'bg-teal-500' : 'bg-border'
            )} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Trip summary row ──────────────────────────────────────────────────────────

function TripRow({ flight, hotel }: { flight: FlightResult | null; hotel: HotelResult | null }) {
  return (
    <div className="space-y-2">
      {flight && (
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/60">
          <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center flex-shrink-0">
            <Plane className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              {flight.origin} <span className="text-muted-foreground font-normal">→</span> {flight.destination}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {flight.airline} · {formatDate(flight.departure)} · {flight.stops === 0 ? 'Non-stop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
            </p>
          </div>
          <p className="text-sm font-black text-foreground flex-shrink-0">
            {formatPrice(flight.price, flight.currency)}
          </p>
        </div>
      )}
      {hotel && (
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border/60">
          <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{hotel.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {hotel.stars}★ · {hotel.checkIn} → {hotel.checkOut}
              {hotel.isSample ? ' · Indicative pricing' : ''}
            </p>
          </div>
          {!hotel.isSample && (
            <p className="text-sm font-black text-foreground flex-shrink-0">
              {formatPrice(hotel.totalPrice, hotel.currency)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Passenger form field ──────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                   bg-background text-foreground placeholder:text-muted-foreground/40
                   focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500
                   transition-all duration-150"
      />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CheckoutCard({ flight, hotel, onClose, onConfirmed }: CheckoutCardProps) {
  const [adults,       setAdults]       = useState(1);
  const [passengers,   setPassengers]   = useState<Passenger[]>([blankPassenger()]);
  const [phase,        setPhase]        = useState<Phase>('review');
  const [error,        setError]        = useState('');
  const [flightRef,    setFlightRef]    = useState('');
  const [hotelRef,     setHotelRef]     = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [currency,     setCurrency]     = useState<'cad' | 'usd'>('cad');
  const [payComplete,  setPayComplete]  = useState(false);

  const stripeRef     = useRef<StripeInstance | null>(null);
  const elementsRef   = useRef<StripeElements | null>(null);
  const mountRef      = useRef<StripePaymentElement | null>(null);
  const paymentDivRef = useRef<HTMLDivElement>(null);

  const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  // Sync passenger array with adults count
  useEffect(() => {
    setPassengers(prev => {
      if (adults > prev.length)
        return [...prev, ...Array.from({ length: adults - prev.length }, blankPassenger)];
      return prev.slice(0, adults);
    });
  }, [adults]);

  // Mount Stripe when entering payment phase
  useEffect(() => {
    if (phase !== 'payment' || !clientSecret || !pk) return;
    let cancelled = false;

    (async () => {
      const stripe = await loadStripe(pk);
      if (!stripe || cancelled) return;
      stripeRef.current = stripe;

      const isDark = document.documentElement.classList.contains('dark');
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: isDark ? 'night' : 'stripe',
          variables: { colorPrimary: '#0d9488', borderRadius: '12px' },
        },
      });
      elementsRef.current = elements;

      const pe = elements.create('payment', { layout: 'tabs' });
      mountRef.current = pe;
      pe.on('change', (e: { complete: boolean }) => setPayComplete(e.complete));

      setTimeout(() => {
        if (paymentDivRef.current && !cancelled) pe.mount(paymentDivRef.current);
      }, 80);
    })();

    return () => {
      cancelled = true;
      mountRef.current?.destroy();
      mountRef.current = null;
    };
  }, [phase, clientSecret, pk]);

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!flight && !hotel) return 'Please select a flight or hotel first.';
    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      if (!p.firstName.trim())  return `Passenger ${i + 1}: first name required`;
      if (!p.lastName.trim())   return `Passenger ${i + 1}: last name required`;
      if (!p.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/))
        return `Passenger ${i + 1}: date of birth required`;
      if (!p.email.includes('@')) return `Passenger ${i + 1}: valid email required`;
      if (!p.phone.trim())      return `Passenger ${i + 1}: phone required`;
    }
    return null;
  }

  // Dev-only: fill all passengers with test data so the form can be bypassed
  const isDev = process.env.NODE_ENV === 'development';
  function fillTestData() {
    const base = [
      { firstName: 'John',  lastName: 'Doe',    dateOfBirth: '1990-01-15', email: 'test@flexetravels.com',  phone: '+14165551234' },
      { firstName: 'Jane',  lastName: 'Doe',    dateOfBirth: '1992-03-22', email: 'test2@flexetravels.com', phone: '+14165551235' },
      { firstName: 'Alice', lastName: 'Smith',  dateOfBirth: '1985-07-04', email: 'test3@flexetravels.com', phone: '+14165551236' },
      { firstName: 'Bob',   lastName: 'Smith',  dateOfBirth: '1983-11-30', email: 'test4@flexetravels.com', phone: '+14165551237' },
      { firstName: 'Carol', lastName: 'Jones',  dateOfBirth: '1978-05-19', email: 'test5@flexetravels.com', phone: '+14165551238' },
      { firstName: 'David', lastName: 'Jones',  dateOfBirth: '1976-09-08', email: 'test6@flexetravels.com', phone: '+14165551239' },
    ];
    setPassengers(passengers.map((_, i) => base[i] ?? base[0]));
  }

  function updatePassenger(i: number, field: keyof Passenger, value: string) {
    setPassengers(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  // ── Book ────────────────────────────────────────────────────────────────────
  const handleBook = useCallback(async () => {
    // Block immediately if the selected hotel is indicative/sample-only
    if (hotel?.isSample) {
      setError(
        `"${hotel.name}" shows indicative pricing only and cannot be booked directly. ` +
        `Please go back and search for available rates at a specific destination.`
      );
      return;
    }

    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setPhase('booking');

    try {
      const res = await fetch('/api/book-trip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightOfferId:    flight?.id,
          hotelRateId:      hotel?.bookingToken,
          hotelName:        hotel?.name,
          passengers:       passengers.slice(0, adults),
          originAirport:    flight?.origin ?? '',
          guestNationality: 'CA',
        }),
      });

      const data = await res.json() as {
        success:        boolean;
        flightRef?:     string;
        hotelRef?:      string;
        flightError?:   string;
        hotelError?:    string;
        clientSecret?:  string;
        currency?:      'cad' | 'usd';
        error?:         string;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? data.flightError ?? data.hotelError ?? 'Booking failed. Please try again.');
        setPhase('error');
        return;
      }

      // If hotel was expected but server silently skipped it, surface the error
      // rather than quietly proceeding to payment without a hotel reservation.
      if (hotel?.bookingToken && !data.hotelRef) {
        setError(
          data.hotelError ??
          `Hotel booking failed for ${hotel.name}. ` +
          `Your flight (${data.flightRef ?? 'pending'}) was reserved — ` +
          `please contact support or try again.`
        );
        setPhase('error');
        return;
      }

      if (data.flightRef) setFlightRef(data.flightRef);
      if (data.hotelRef)  setHotelRef(data.hotelRef);
      if (data.currency)  setCurrency(data.currency);

      if (data.clientSecret) {
        setClientSecret(data.clientSecret);
        setPhase('payment');
      } else {
        setPhase('success');
        onConfirmed?.(data.flightRef, data.hotelRef);
      }
    } catch (e) {
      setError(`Network error: ${String(e)}`);
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passengers, adults, flight, hotel, onConfirmed]);

  // ── Pay ─────────────────────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setError('');

    const { error: submitErr } = await elementsRef.current.submit();
    if (submitErr) { setError(submitErr.message); return; }

    const result = await stripeRef.current.confirmPayment({
      elements:      elementsRef.current,
      confirmParams: { return_url: `${window.location.origin}/booking?ref=${flightRef || hotelRef}&fee_paid=true` },
      redirect:      'if_required',
    });

    if (result.error) {
      setError(result.error.message);
    } else {
      setPhase('success');
      mountRef.current?.unmount();
      onConfirmed?.(flightRef || undefined, hotelRef || undefined);
    }
  }, [flightRef, hotelRef, onConfirmed]);

  const feeDisplay = formatPrice(20, currency.toUpperCase());

  // ── Success ─────────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="travel-card p-6 space-y-4 animate-fade-in-up text-center">
        <div className="w-14 h-14 rounded-full bg-teal-500/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <h3 className="font-black text-lg text-foreground tracking-tight">You&apos;re all set!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Confirmation details have been sent to your email.
          </p>
        </div>
        <div className="space-y-2 text-left">
          {flightRef && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Plane className="w-3.5 h-3.5" /> Flight reference
              </div>
              <code className="text-sm font-black text-foreground font-mono tracking-wide">{flightRef}</code>
            </div>
          )}
          {hotelRef && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="w-3.5 h-3.5" /> Hotel booking
              </div>
              <code className="text-sm font-black text-foreground font-mono tracking-wide">{hotelRef}</code>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Service fee of {feeDisplay} processed · Powered by Stripe
        </p>
      </div>
    );
  }

  // ── Booking spinner ──────────────────────────────────────────────────────────
  if (phase === 'booking') {
    return (
      <div className="travel-card p-8 animate-fade-in-up flex flex-col items-center gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-teal-500/10 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-teal-600 animate-spin" />
        </div>
        <div>
          <p className="font-bold text-base text-foreground">Securing your reservation…</p>
          <p className="text-sm text-muted-foreground mt-1">This usually takes 10–20 seconds</p>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground/70">
          {flight && <span>✈ Booking flight</span>}
          {hotel  && <span>🏨 Booking hotel</span>}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="travel-card p-6 space-y-4 animate-fade-in-up">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <div className="text-center">
          <p className="font-bold text-base text-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground/80 mt-1">{error}</p>
        </div>
        <button
          onClick={() => { setPhase('passengers'); setError(''); }}
          className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── Main card shell ──────────────────────────────────────────────────────────
  return (
    <div className="travel-card overflow-hidden animate-fade-in-up">
      {/* Header */}
      <div className="px-5 pt-5 pb-0 flex items-center justify-between">
        <h2 className="font-black text-base text-foreground tracking-tight">Complete Booking</h2>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-muted/60 hover:bg-muted flex items-center justify-center transition-colors"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <div className="px-5 pt-4 pb-5 space-y-5">
        <StepDots phase={phase} />

        {/* ── Step 1: Review ─────────────────────────────────────────────────── */}
        {phase === 'review' && (
          <div className="space-y-5">
            <TripRow flight={flight} hotel={hotel} />

            {/* Passenger count */}
            <div className="flex items-center justify-between px-3.5 py-3 rounded-2xl border border-border/60 bg-muted/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <User className="w-4 h-4 text-teal-600" />
                Passengers
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAdults(a => Math.max(1, a - 1))}
                  className="w-7 h-7 rounded-full border border-border flex items-center justify-center
                             hover:bg-muted hover:border-teal-500 transition-all text-foreground"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-base font-black w-4 text-center text-foreground">{adults}</span>
                <button
                  onClick={() => setAdults(a => Math.min(6, a + 1))}
                  className="w-7 h-7 rounded-full border border-border flex items-center justify-center
                             hover:bg-muted hover:border-teal-500 transition-all text-foreground"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Service fee line */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Lock className="w-3.5 h-3.5" />
                FlexeTravels service fee
              </div>
              <span className="font-bold text-teal-700 dark:text-teal-300">{feeDisplay}</span>
            </div>

            <button
              onClick={() => setPhase('passengers')}
              className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-[0.98]
                         text-white font-bold text-sm flex items-center justify-center gap-2
                         shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 transition-all duration-150"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-center text-[10px] text-muted-foreground/50">
              Secured by Stripe · PCI-DSS compliant
            </p>
          </div>
        )}

        {/* ── Step 2: Passengers ─────────────────────────────────────────────── */}
        {phase === 'passengers' && (
          <div className="space-y-5">
            {/* Dev-only: one-click test data fill */}
            {isDev && (
              <button
                type="button"
                onClick={fillTestData}
                className="w-full py-2 rounded-xl border border-dashed border-amber-400/60
                           bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400
                           text-xs font-bold tracking-wide hover:bg-amber-100/60 dark:hover:bg-amber-900/30
                           transition-colors"
              >
                ⚡ Fill test data
              </button>
            )}

            {passengers.map((pax, i) => (
              <div key={i} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center">
                    <span className="text-[11px] font-black text-teal-600">{i + 1}</span>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {i === 0 ? 'Lead Passenger' : `Passenger ${i + 1}`}
                  </p>
                </div>

                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="First Name"
                      value={pax.firstName}
                      onChange={v => updatePassenger(i, 'firstName', v)}
                      placeholder="As on passport"
                    />
                    <Field
                      label="Last Name"
                      value={pax.lastName}
                      onChange={v => updatePassenger(i, 'lastName', v)}
                      placeholder="As on passport"
                    />
                  </div>
                  <Field
                    label="Date of Birth"
                    value={pax.dateOfBirth}
                    onChange={v => updatePassenger(i, 'dateOfBirth', v)}
                    type="date"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Email"
                      value={pax.email}
                      onChange={v => updatePassenger(i, 'email', v)}
                      type="email"
                      placeholder="you@email.com"
                    />
                    <Field
                      label="Phone"
                      value={pax.phone}
                      onChange={v => updatePassenger(i, 'phone', v)}
                      type="tel"
                      placeholder="+1 416 555 1234"
                    />
                  </div>
                </div>

                {i < passengers.length - 1 && (
                  <div className="border-t border-border/40 pt-1" />
                )}
              </div>
            ))}

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setPhase('review'); setError(''); }}
                className="flex items-center gap-1.5 px-4 py-3 rounded-2xl border border-border/80
                           text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={handleBook}
                className="flex-1 py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-[0.98]
                           text-white font-bold text-sm flex items-center justify-center gap-2
                           shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 transition-all duration-150"
              >
                Book Trip <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Stripe payment ─────────────────────────────────────────── */}
        {phase === 'payment' && (
          <div className="space-y-4">
            {/* Booking confirmations */}
            <div className="space-y-1.5">
              {flightRef && (
                <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300
                                bg-teal-50 dark:bg-teal-950/30 px-3 py-2 rounded-xl">
                  <Plane className="w-3.5 h-3.5 flex-shrink-0" />
                  Flight booked — ref: <code className="font-mono font-black">{flightRef}</code>
                </div>
              )}
              {hotelRef && (
                <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300
                                bg-teal-50 dark:bg-teal-950/30 px-3 py-2 rounded-xl">
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Hotel booked — ID: <code className="font-mono font-black">{hotelRef}</code>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-sm py-2 border-t border-border/50">
              <span className="font-semibold text-foreground">Service fee</span>
              <span className="font-black text-teal-700 dark:text-teal-300">{feeDisplay}</span>
            </div>

            {/* Stripe mounts here */}
            <div ref={paymentDivRef} className="min-h-[140px]" />

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={!payComplete}
              className={cn(
                'w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2',
                'bg-teal-600 text-white transition-all duration-150',
                'shadow-md shadow-teal-500/20',
                'enabled:hover:bg-teal-700 enabled:hover:shadow-lg enabled:active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              <Lock className="w-3.5 h-3.5" />
              Pay {feeDisplay} securely
            </button>
            <p className="text-center text-[10px] text-muted-foreground/50">
              Powered by Stripe · PCI-DSS compliant
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
