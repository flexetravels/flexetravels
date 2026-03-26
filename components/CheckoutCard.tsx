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

interface ChildPassenger {
  firstName:   string;
  lastName:    string;
  dateOfBirth: string;   // YYYY-MM-DD — needed to calculate age for Duffel/LiteAPI
}

const blankPassenger = (): Passenger => ({
  firstName: '', lastName: '', dateOfBirth: '', email: '', phone: '',
});

const blankChild = (): ChildPassenger => ({
  firstName: '', lastName: '', dateOfBirth: '',
});

interface CheckoutCardProps {
  flight:           FlightResult | null;
  hotel:            HotelResult  | null;
  onClose:          () => void;
  onConfirmed?:     (flightRef?: string, hotelRef?: string) => void;
  initialAdults?:   number;    // pre-fill from search (e.g. "2 passengers")
  initialChildren?: number;    // pre-fill children count from search
  sessionId?:       string;    // chat session ID — passed to API for DB persistence
}

type Phase = 'review' | 'passengers' | 'booking' | 'payment' | 'hotel-payment' | 'hotel-paying' | 'success' | 'error';

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Review', 'Passengers', 'Pay'] as const;
type StepLabel = typeof STEPS[number];

function phaseToStep(phase: Phase): number {
  if (phase === 'review')                                                    return 0;
  if (phase === 'passengers')                                                return 1;
  if (phase === 'booking' || phase === 'payment' || phase === 'hotel-payment' || phase === 'hotel-paying') return 2;
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

// ─── Child age + fare tier display ────────────────────────────────────────────

function ChildAgeBadge({ dob }: { dob: string }) {
  if (!dob.match(/^\d{4}-\d{2}-\d{2}$/)) return null;

  const born  = new Date(dob);
  const today = new Date();
  // Full years, accounting for birthday not yet passed this year
  const age = today.getFullYear() - born.getFullYear()
    - (today < new Date(today.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);

  // Sanity check — ignore obviously wrong dates
  if (age < 0 || age > 17) return null;

  let tier: string;
  let colour: string;
  if (age < 2) {
    tier   = `${age === 0 ? 'Under 1' : `${age} yr`} · Infant on lap — no seat`;
    colour = 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400';
  } else if (age < 12) {
    tier   = `${age} yrs · Child fare — own seat`;
    colour = 'text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/30 dark:border-teal-800 dark:text-teal-400';
  } else {
    tier   = `${age} yrs · Adult fare applies`;
    colour = 'text-slate-600 bg-slate-50 border-slate-200 dark:bg-slate-800/40 dark:border-slate-700 dark:text-slate-400';
  }

  return (
    <p className={cn('text-[10px] font-semibold px-2.5 py-1 rounded-lg border w-fit mt-0.5', colour)}>
      {tier}
    </p>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CheckoutCard({ flight, hotel, onClose, onConfirmed, initialAdults, initialChildren, sessionId }: CheckoutCardProps) {
  const [adults,          setAdults]          = useState(initialAdults ?? 1);
  const [passengers,      setPassengers]      = useState<Passenger[]>(
    Array.from({ length: initialAdults ?? 1 }, blankPassenger)
  );
  const [children,           setChildren]           = useState(initialChildren ?? 0);
  const [childPassengers,    setChildPassengers]    = useState<ChildPassenger[]>(
    Array.from({ length: initialChildren ?? 0 }, blankChild)
  );
  const [phase,        setPhase]        = useState<Phase>('review');
  const [error,        setError]        = useState('');
  const [flightRef,    setFlightRef]    = useState('');
  const [hotelRef,     setHotelRef]     = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [currency,     setCurrency]     = useState<'cad' | 'usd'>('cad');
  const [payComplete,  setPayComplete]  = useState(false);
  // Confirmation state when no flight is in cart (hotel-only booking)
  const [confirmFlightless, setConfirmFlightless] = useState(false);

  // ── LiteAPI payment SDK state (production only) ─────────────────────────────
  // Populated when /api/book-trip returns requiresHotelPayment: true.
  // The SDK widget renders at https://payment-wrapper.liteapi.travel
  const [hotelPrebookId,      setHotelPrebookId]      = useState('');
  const [hotelSecretKey,      setHotelSecretKey]       = useState('');
  const [hotelTransactionId,  setHotelTransactionId]   = useState('');
  const liteapiPayDivRef = useRef<HTMLDivElement>(null);

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

  // Sync child passenger array with children count
  useEffect(() => {
    setChildPassengers(prev => {
      if (children > prev.length)
        return [...prev, ...Array.from({ length: children - prev.length }, blankChild)];
      return prev.slice(0, children);
    });
  }, [children]);

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

  // ── LiteAPI payment SDK (production) ─────────────────────────────────────────
  // Loaded when usePaymentSdk: true — customer pays hotel cost directly through
  // LiteAPI's hosted Stripe-powered widget. We never touch their card data.
  useEffect(() => {
    if (phase !== 'hotel-payment' || !hotelSecretKey || !liteapiPayDivRef.current) return;
    let cancelled = false;

    // Determine environment from API key presence or NEXT_PUBLIC_ flag
    const isSandbox = !!(process.env.NEXT_PUBLIC_LITEAPI_SANDBOX);

    (async () => {
      // Load LiteAPI payment SDK script from their CDN
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[src*="liteAPIPayment"]');
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1';
        s.onload  = () => resolve();
        s.onerror = () => reject(new Error('LiteAPI payment SDK failed to load'));
        document.head.appendChild(s);
      });

      if (cancelled || !liteapiPayDivRef.current) return;

      // Initialise the widget — mounts a Stripe-powered payment form in the target div
      const LiteAPIPayment = (window as unknown as Record<string, unknown>)['LiteAPIPayment'] as ((opts: Record<string, unknown>) => void) | undefined;
      if (!LiteAPIPayment) {
        setError('Payment widget failed to load. Please refresh and try again.');
        setPhase('error');
        return;
      }

      LiteAPIPayment({
        publicKey:     isSandbox ? 'sandbox' : 'live',
        secretKey:     hotelSecretKey,
        targetElement: '#liteapi-payment-container',
        appearance:    'flat',
        options:       { name: 'FlexeTravels' },
        // returnUrl is used when 3D Secure redirect is required
        returnUrl: `${window.location.origin}/booking?hotel_payment=complete&prebookId=${encodeURIComponent(hotelPrebookId)}`,
      });
    })().catch(err => {
      if (!cancelled) {
        setError(String(err));
        setPhase('error');
      }
    });

    return () => { cancelled = true; };
  }, [phase, hotelSecretKey, hotelPrebookId]);

  // ── Complete hotel booking after LiteAPI payment SDK ──────────────────────────
  const handleHotelPayComplete = useCallback(async () => {
    if (!hotelPrebookId || !hotelTransactionId) {
      setError('Payment session data missing. Please try again.');
      return;
    }
    setPhase('hotel-paying');
    const lead = passengers[0];
    try {
      const res = await fetch('/api/complete-hotel-booking', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prebookId:      hotelPrebookId,
          transactionId:  hotelTransactionId,
          guestFirstName: lead.firstName,
          guestLastName:  lead.lastName,
          guestEmail:     lead.email,
        }),
      });
      const data = await res.json() as { success: boolean; bookingId?: string; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Hotel booking failed after payment. Please contact support.');
        setPhase('error');
        return;
      }
      if (data.bookingId) setHotelRef(data.bookingId);
      setPhase('success');
      onConfirmed?.(flightRef || undefined, data.bookingId || undefined);
    } catch (e) {
      setError(`Network error: ${String(e)}`);
      setPhase('error');
    }
  }, [hotelPrebookId, hotelTransactionId, passengers, flightRef, onConfirmed]);

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (!flight && !hotel) return 'Please select a flight or hotel first.';
    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      if (!p.firstName.trim())  return `Adult ${i + 1}: first name required`;
      if (!p.lastName.trim())   return `Adult ${i + 1}: last name required`;
      if (!p.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/))
        return `Adult ${i + 1}: date of birth required`;
      if (!p.email.includes('@')) return `Adult ${i + 1}: valid email required`;
      if (!p.phone.trim())      return `Adult ${i + 1}: phone required`;
    }
    for (let i = 0; i < childPassengers.length; i++) {
      const c = childPassengers[i];
      if (!c.firstName.trim())  return `Child ${i + 1}: first name required`;
      if (!c.lastName.trim())   return `Child ${i + 1}: last name required`;
      if (!c.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/))
        return `Child ${i + 1}: date of birth required`;
    }
    return null;
  }

  function updateChildPassenger(i: number, field: keyof ChildPassenger, value: string) {
    setChildPassengers(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  // Dev-only: fill all passengers with test data so the form can be bypassed
  const isDev = process.env.NODE_ENV === 'development';
  function fillTestData() {
    const adultBase = [
      { firstName: 'John',  lastName: 'Doe',   dateOfBirth: '1990-01-15', email: 'test@flexetravels.com',  phone: '+14165551234' },
      { firstName: 'Jane',  lastName: 'Doe',   dateOfBirth: '1992-03-22', email: 'test2@flexetravels.com', phone: '+14165551235' },
      { firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1985-07-04', email: 'test3@flexetravels.com', phone: '+14165551236' },
      { firstName: 'Bob',   lastName: 'Smith', dateOfBirth: '1983-11-30', email: 'test4@flexetravels.com', phone: '+14165551237' },
    ];
    const childBase = [
      { firstName: 'Emma',  lastName: 'Doe',   dateOfBirth: '2016-06-10' },
      { firstName: 'Liam',  lastName: 'Doe',   dateOfBirth: '2018-11-22' },
      { firstName: 'Olivia',lastName: 'Smith', dateOfBirth: '2019-03-05' },
    ];
    setPassengers(passengers.map((_, i) => adultBase[i] ?? adultBase[0]));
    if (childPassengers.length > 0) {
      setChildPassengers(childPassengers.map((_, i) => childBase[i] ?? childBase[0]));
    }
  }

  function updatePassenger(i: number, field: keyof Passenger, value: string) {
    setPassengers(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  // ── Book ────────────────────────────────────────────────────────────────────
  // NOTE: childPassengers + children MUST be in the dep array so validate()
  // inside the callback sees the latest typed values (not the stale initial state).
  const handleBook = useCallback(async (skipFlightConfirm = false) => {
    // Block immediately if the selected hotel is indicative/sample-only
    if (hotel?.isSample) {
      setError(
        `"${hotel.name}" shows indicative pricing only and cannot be booked directly. ` +
        `Please go back and search for available rates at a specific destination.`
      );
      return;
    }

    // If no flight offer ID is available, ask the user to confirm hotel-only booking
    // (catches: no flight selected, AI emitted a placeholder/broken offer ID)
    const flightId = flight?.id;
    const PLACEHOLDER_RE = /^(<.*>|N\/A|TBD|pending|unknown|loading|undefined|null|example|test|sample)$/i;
    const hasValidFlightId = !!(
      flightId &&
      !flightId.startsWith('<') &&
      flightId.length >= 6 &&
      !PLACEHOLDER_RE.test(flightId.trim())
    );
    if (!hasValidFlightId && !skipFlightConfirm) {
      setConfirmFlightless(true);
      return;
    }

    // Hotel bookingToken guard — must start with 'liteapi_' and have real content after it
    const hotelToken = hotel?.bookingToken ?? '';
    const hasValidHotelToken = !!(
      hotelToken &&
      hotelToken.startsWith('liteapi_') &&
      hotelToken.replace('liteapi_', '').length >= 6 &&
      !PLACEHOLDER_RE.test(hotelToken.replace('liteapi_', '').trim())
    );
    if (hotel && !hasValidHotelToken) {
      setError('This hotel cannot be booked directly — the rate token is missing. Please go back and select a different hotel.');
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
          sessionId:        sessionId,
          flightOfferId:    hasValidFlightId ? flightId : undefined,
          hotelRateId:      hasValidHotelToken ? hotelToken : undefined,
          hotelName:        hotel?.name,
          // Pass hotel metadata so the server re-fetches a live offerId at booking
          // time, bypassing the cached token which can expire within minutes.
          hotelId:          hotel?.id,
          hotelCheckIn:     hotel?.checkIn,
          hotelCheckOut:    hotel?.checkOut,
          passengers:       passengers.slice(0, adults),
          childPassengers:  childPassengers.slice(0, children),
          originAirport:    flight?.origin ?? '',
          guestNationality: 'CA',
        }),
      });

      const data = await res.json() as {
        success:              boolean;
        flightRef?:           string;
        hotelRef?:            string;
        flightError?:         string;
        hotelError?:          string;
        clientSecret?:        string;
        currency?:            'cad' | 'usd';
        error?:               string;
        // LiteAPI payment SDK fields (production)
        requiresHotelPayment?: boolean;
        hotelPrebookId?:       string;
        hotelSecretKey?:       string;
        hotelTransactionId?:   string;
        isSandboxBooking?:     boolean;
      };

      if (!res.ok || !data.success) {
        setError(data.error ?? data.flightError ?? data.hotelError ?? 'Booking failed. Please try again.');
        setPhase('error');
        return;
      }

      if (data.flightRef) setFlightRef(data.flightRef);
      if (data.hotelRef)  setHotelRef(data.hotelRef);
      if (data.currency)  setCurrency(data.currency);

      // ── Production hotel payment via LiteAPI SDK ─────────────────────────────
      // If requiresHotelPayment, LiteAPI needs the customer to pay directly through
      // their hosted payment widget. Show the SDK widget before proceeding.
      if (data.requiresHotelPayment && data.hotelPrebookId && data.hotelSecretKey) {
        setHotelPrebookId(data.hotelPrebookId);
        setHotelSecretKey(data.hotelSecretKey);
        setHotelTransactionId(data.hotelTransactionId ?? '');
        setPhase('hotel-payment');
        return;
      }

      // If hotel was expected but server silently skipped it (sandbox), surface the error.
      if (hotel?.bookingToken && !data.hotelRef && !data.requiresHotelPayment) {
        setError(
          data.hotelError ??
          `Hotel booking failed for ${hotel.name}. ` +
          `Your flight (${data.flightRef ?? 'pending'}) was reserved — ` +
          `please contact support or try again.`
        );
        setPhase('error');
        return;
      }

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
  }, [passengers, adults, children, childPassengers, flight, hotel, onConfirmed]);

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
    const isRateExpired = error.startsWith('HOTEL_RATE_EXPIRED:');
    const displayError  = isRateExpired ? error.replace('HOTEL_RATE_EXPIRED: ', '') : error;
    return (
      <div className="travel-card p-6 space-y-4 animate-fade-in-up">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${isRateExpired ? 'bg-amber-500/10' : 'bg-red-500/10'}`}>
          <AlertCircle className={`w-6 h-6 ${isRateExpired ? 'text-amber-500' : 'text-red-500'}`} />
        </div>
        <div className="text-center">
          <p className="font-bold text-base text-foreground">
            {isRateExpired ? 'Hotel rates have expired' : 'Something went wrong'}
          </p>
          <p className="text-sm text-muted-foreground/80 mt-1">{displayError}</p>
        </div>
        {isRateExpired ? (
          <a
            href="/chat"
            className="block w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm text-center transition-colors"
          >
            ← Back to chat to search again
          </a>
        ) : (
          <button
            onClick={() => { setPhase('passengers'); setError(''); }}
            className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    );
  }

  // ── Main card shell ──────────────────────────────────────────────────────────
  return (
    <div className="travel-card overflow-hidden animate-fade-in-up relative">

      {/* ── No-flight confirmation overlay ───────────────────────────────────── */}
      {confirmFlightless && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm rounded-[inherit] p-5">
          <div className="max-w-sm w-full bg-card border border-border/60 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">No flight selected</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  It looks like no flight was found in your cart. You can continue to book the hotel only, or go back to chat and select a flight first.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                onClick={() => { setConfirmFlightless(false); }}
                className="flex-1 py-2.5 rounded-2xl border border-border/80 text-sm font-semibold
                           text-muted-foreground hover:bg-muted transition-colors"
              >
                ← Back to chat
              </button>
              <button
                onClick={() => { setConfirmFlightless(false); void handleBook(true); }}
                className="flex-1 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white
                           font-bold text-sm transition-colors"
              >
                Hotel only →
              </button>
            </div>
          </div>
        </div>
      )}

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

            {/* Block right here if the hotel is a sample — don't let user waste time in passengers */}
            {hotel?.isSample && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-2">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  ⚠ &ldquo;{hotel.name}&rdquo; is an estimated price — not bookable
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  Live hotel rates aren&apos;t available for this destination. Please go back and search for hotels — try a more specific city name or different dates to see real bookable options.
                </p>
              </div>
            )}

            {/* Passenger counts */}
            <div className="space-y-2">
              {/* Adults — capped at the count searched for (offer is priced for that many seats) */}
              {(() => {
                const maxAdults = initialAdults ?? 1;
                const atMax = adults >= maxAdults;
                return (
                  <div className="flex items-center justify-between px-3.5 py-3 rounded-2xl border border-border/60 bg-muted/20">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <User className="w-4 h-4 text-teal-600" />
                        Adults
                      </div>
                      {atMax && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">
                          Seats locked to search count. Go back to chat to change.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <button
                        onClick={() => setAdults(a => Math.max(1, a - 1))}
                        className="w-7 h-7 rounded-full border border-border flex items-center justify-center
                                   hover:bg-muted hover:border-teal-500 transition-all text-foreground"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-base font-black w-4 text-center text-foreground">{adults}</span>
                      <button
                        onClick={() => setAdults(a => Math.min(maxAdults, a + 1))}
                        disabled={atMax}
                        className={cn(
                          'w-7 h-7 rounded-full border flex items-center justify-center transition-all',
                          atMax
                            ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
                            : 'border-border hover:bg-muted hover:border-teal-500 text-foreground'
                        )}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Children — read-only summary, set from chat */}
              {children > 0 && (
                <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl border border-border/60 bg-muted/20">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <User className="w-4 h-4 text-teal-600/70" />
                    Children
                  </div>
                  <span className="text-sm font-black text-foreground">{children}</span>
                </div>
              )}
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
              disabled={!!hotel?.isSample}
              className={cn(
                'w-full py-3.5 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-all duration-150',
                hotel?.isSample
                  ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                  : 'bg-teal-600 hover:bg-teal-700 active:scale-[0.98] shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30'
              )}
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
          <div className="flex flex-col gap-0">
            {/* Scrollable form area — button stays visible below */}
            <div className="space-y-5 overflow-y-auto max-h-[52vh] pr-1
                            [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">
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

            {/* ── Adult passengers ─────────────────────────────────────── */}
            {passengers.map((pax, i) => (
              <div key={`adult-${i}`} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center">
                    <span className="text-[11px] font-black text-teal-600">{i + 1}</span>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {i === 0 ? 'Lead Passenger' : `Adult ${i + 1}`}
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

                {(i < passengers.length - 1 || childPassengers.length > 0) && (
                  <div className="border-t border-border/40 pt-1" />
                )}
              </div>
            ))}

            {/* ── Child passengers ─────────────────────────────────────── */}
            {childPassengers.map((child, i) => (
              <div key={`child-${i}`} className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <span className="text-[11px] font-black text-amber-600">{i + 1}</span>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Child {i + 1}
                  </p>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">under 12</span>
                </div>

                <div className="space-y-3 pl-1">
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="First Name"
                      value={child.firstName}
                      onChange={v => updateChildPassenger(i, 'firstName', v)}
                      placeholder="As on passport"
                    />
                    <Field
                      label="Last Name"
                      value={child.lastName}
                      onChange={v => updateChildPassenger(i, 'lastName', v)}
                      placeholder="As on passport"
                    />
                  </div>
                  <div>
                    <Field
                      label="Date of Birth"
                      value={child.dateOfBirth}
                      onChange={v => updateChildPassenger(i, 'dateOfBirth', v)}
                      type="date"
                    />
                    <ChildAgeBadge dob={child.dateOfBirth} />
                  </div>
                </div>

                {i < childPassengers.length - 1 && (
                  <div className="border-t border-border/40 pt-1" />
                )}
              </div>
            ))}

            </div>{/* end scrollable form area */}

            {error && (
              <div className="flex items-start gap-2 p-3 mt-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-border/30 mt-3">
              <button
                onClick={() => { setPhase('review'); setError(''); }}
                className="flex items-center gap-1.5 px-4 py-3 rounded-2xl border border-border/80
                           text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => void handleBook()}
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

        {/* ── LiteAPI hotel payment widget (production only) ─────────────────── */}
        {(phase === 'hotel-payment' || phase === 'hotel-paying') && (
          <div className="space-y-4">
            {/* Flight confirmation if already booked */}
            {flightRef && (
              <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300
                              bg-teal-50 dark:bg-teal-950/30 px-3 py-2 rounded-xl">
                <Plane className="w-3.5 h-3.5 flex-shrink-0" />
                Flight booked — ref: <code className="font-mono font-black">{flightRef}</code>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Complete hotel payment</p>
              <p className="text-xs text-muted-foreground">
                Enter your card details below. Payment is processed securely by LiteAPI — FlexeTravels never stores your card data.
              </p>
            </div>

            {/* LiteAPI payment SDK mounts here */}
            <div
              id="liteapi-payment-container"
              ref={liteapiPayDivRef}
              className="min-h-[200px] rounded-xl overflow-hidden"
            />

            {phase === 'hotel-paying' && (
              <div className="flex items-center justify-center gap-2 text-sm text-teal-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Confirming your hotel booking…
              </div>
            )}

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}

            {phase === 'hotel-payment' && (
              <button
                onClick={handleHotelPayComplete}
                className={cn(
                  'w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2',
                  'bg-teal-600 text-white transition-all duration-150',
                  'shadow-md shadow-teal-500/20',
                  'hover:bg-teal-700 hover:shadow-lg active:scale-[0.98]'
                )}
              >
                <Lock className="w-3.5 h-3.5" />
                Confirm hotel booking
              </button>
            )}
            <p className="text-center text-[10px] text-muted-foreground/50">
              Hotel payment processed by LiteAPI · Powered by Stripe
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
