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
  ChevronDown, ChevronUp, Clock,
} from 'lucide-react';
import { cn, formatPrice, formatDate, formatTime, iataToCity } from '@/lib/utils';
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
  title:       'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  gender:      'm' | 'f';
  nationality?: string;  // MEDIUM severity: nationality code (e.g., 'CA', 'US', 'GB')
  // Passport / travel document — required by Duffel for international flights
  passportNumber:         string;   // document number
  passportIssuingCountry: string;   // ISO 3166-1 alpha-2 e.g. 'CA'
  passportExpiry:         string;   // YYYY-MM-DD
}

interface ChildPassenger {
  firstName:   string;
  lastName:    string;
  dateOfBirth: string;   // YYYY-MM-DD — needed to calculate age for Duffel/LiteAPI
  gender:      'm' | 'f';
  // Passport / travel document
  passportNumber:         string;
  passportIssuingCountry: string;
  passportExpiry:         string;
}

const blankPassenger = (): Passenger => ({
  firstName: '', lastName: '', dateOfBirth: '', email: '', phone: '',
  title: 'mr', gender: 'm',
  passportNumber: '', passportIssuingCountry: 'CA', passportExpiry: '',
});

const blankChild = (): ChildPassenger => ({
  firstName: '', lastName: '', dateOfBirth: '', gender: 'm',
  passportNumber: '', passportIssuingCountry: 'CA', passportExpiry: '',
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

type Phase = 'review' | 'passengers' | 'invoice' | 'booking' | 'payment' | 'hotel-payment' | 'hotel-paying' | 'success' | 'error';

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Review', 'Passengers', 'Invoice', 'Pay'] as const;
type StepLabel = typeof STEPS[number];

function phaseToStep(phase: Phase): number {
  if (phase === 'review')      return 0;
  if (phase === 'passengers')  return 1;
  if (phase === 'invoice')     return 2;
  if (phase === 'booking' || phase === 'payment' || phase === 'hotel-payment' || phase === 'hotel-paying') return 3;
  return 3;
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

function calcLayoverMins(arrivalIso: string, departureIso: string): string | null {
  try {
    const diff = new Date(departureIso).getTime() - new Date(arrivalIso).getTime();
    if (diff <= 0 || isNaN(diff)) return null;
    const h = Math.floor(diff / 3_600_000);
    const m = Math.round((diff % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return null; }
}

/** Render a list of flight segments as a compact timeline */
function SegmentList({ segs, baggage }: { segs: FlightResult['segments']; baggage?: string }) {
  if (!segs || segs.length === 0) return null;
  return (
    <div className="space-y-0">
      {segs.map((seg, i) => {
        const layover = i < segs.length - 1
          ? calcLayoverMins(seg.arrival, segs[i + 1].departure)
          : null;
        return (
          <div key={i}>
            <div className="flex items-start gap-2.5 py-2 text-xs">
              <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-teal-500 ring-2 ring-teal-200 dark:ring-teal-800" />
                {(layover || i < segs.length - 1) && (
                  <div className="w-px flex-1 min-h-[28px] bg-teal-400/30 mt-1" />
                )}
              </div>
              <div className="flex-1 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-foreground">{seg.origin} → {seg.destination}</p>
                  {seg.flightNumber && (
                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {seg.flightNumber}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5">
                  {formatDate(seg.departure)} · {formatTime(seg.departure)} – {formatTime(seg.arrival)}
                </p>
                <div className="flex items-center gap-3 mt-0.5 text-muted-foreground/70 text-[10px]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {seg.duration}
                  </span>
                  {baggage && i === 0 && (
                    <span className="text-teal-600 dark:text-teal-400 font-medium">✓ {baggage}</span>
                  )}
                </div>
              </div>
            </div>
            {layover && (
              <div className="ml-4.5 mb-1 flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20
                                border border-amber-200 dark:border-amber-700/50
                                text-amber-700 dark:text-amber-400
                                px-2.5 py-1 rounded-full text-[10px] font-semibold">
                  <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                  Layover in {iataToCity(seg.destination)} ({seg.destination}): {layover}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {/* Final destination dot */}
      <div className="flex items-center gap-2.5 pt-0.5">
        <div className="w-2 h-2 rounded-full bg-teal-600 ring-2 ring-teal-200 dark:ring-teal-800 flex-shrink-0" />
        <p className="text-[11px] font-semibold text-foreground">
          {segs[segs.length - 1]?.destination} — {formatTime(segs[segs.length - 1]?.arrival)}, {formatDate(segs[segs.length - 1]?.arrival)}
        </p>
      </div>
    </div>
  );
}

function TripRow({ flight, hotel }: { flight: FlightResult | null; hotel: HotelResult | null }) {
  const [flightExpanded, setFlightExpanded] = useState(false);

  const segs = flight?.segments ?? [];
  const returnSegs = flight?.returnSegments ?? [];
  const hasSegments = segs.length > 0;
  const isRoundTrip = flight?.isRoundTrip && flight.returnDeparture;
  const totalLegs = segs.length + returnSegs.length;

  return (
    <div className="space-y-2">
      {flight && (
        <div className="rounded-2xl bg-muted/40 border border-border/60 overflow-hidden">
          {/* Compact summary row */}
          <div className="flex items-center gap-3 p-3.5">
            <div className="w-8 h-8 rounded-xl bg-teal-500/10 flex items-center justify-center flex-shrink-0">
              <Plane className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div className="flex-1 min-w-0">
              {isRoundTrip ? (
                <>
                  <p className="text-sm font-bold text-foreground">
                    {flight.origin} <span className="text-muted-foreground font-normal">→</span> {flight.destination}
                    <span className="text-muted-foreground font-normal mx-1">·</span>
                    {flight.returnOrigin ?? flight.destination} <span className="text-muted-foreground font-normal">→</span> {flight.returnDestination ?? flight.origin}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {flight.airline} · Round-trip · {formatDate(flight.departure)} → {formatDate(flight.returnDeparture ?? '')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-foreground">
                    {flight.origin} <span className="text-muted-foreground font-normal">→</span> {flight.destination}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {flight.airline} · {formatDate(flight.departure)} · {flight.stops === 0 ? 'Non-stop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
                    {flight.duration ? ` · ${flight.duration}` : ''}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <p className="text-sm font-black text-foreground">
                {formatPrice(flight.price, flight.currency)}
              </p>
              {hasSegments && (
                <button
                  type="button"
                  onClick={() => setFlightExpanded(e => !e)}
                  className="p-1 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                  title={flightExpanded ? 'Hide details' : 'Show flight details'}
                >
                  {flightExpanded
                    ? <ChevronUp className="w-4 h-4" />
                    : <ChevronDown className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {/* Expandable segment details */}
          {flightExpanded && hasSegments && (
            <div className="border-t border-border/40 bg-muted/20 px-3.5 py-3">
              {/* Outbound label for round-trips */}
              {isRoundTrip && (
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1 mb-1">
                  <Plane className="w-3 h-3 -rotate-45" /> Outbound
                </p>
              )}
              <SegmentList segs={segs} baggage={flight.baggage} />

              {/* Return leg */}
              {isRoundTrip && returnSegs.length > 0 && (
                <>
                  <div className="border-t border-dashed border-border/60 my-3" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1 mb-1">
                    <Plane className="w-3 h-3 rotate-[135deg]" /> Return
                  </p>
                  <SegmentList segs={returnSegs} />
                </>
              )}

              {/* Baggage + flexibility */}
              {flight.baggage && (
                <p className="text-[11px] text-teal-600 dark:text-teal-400 font-medium mt-2 pl-4.5">
                  ✓ {flight.baggage} included
                </p>
              )}
              {flight.flexibilitySummary && (
                <p className="text-[10px] text-muted-foreground mt-2 pl-4.5 bg-muted/40 rounded px-2 py-1.5">
                  {flight.flexibilitySummary}
                </p>
              )}
            </div>
          )}

          {/* "Show details" hint when collapsed and segments exist */}
          {!flightExpanded && hasSegments && (
            <button
              type="button"
              onClick={() => setFlightExpanded(true)}
              className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px]
                         text-muted-foreground hover:text-teal-600 dark:hover:text-teal-400
                         border-t border-border/40 bg-muted/10 hover:bg-muted/30 transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              {isRoundTrip
                ? `Flight details · outbound + return (${totalLegs} leg${totalLegs !== 1 ? 's' : ''})`
                : `Flight details · ${segs.length} leg${segs.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {/* ── Return leg (round-trip) ──────────────────────────────────── */}
      {flight && flight.returnSegments && flight.returnSegments.length > 0 && (
        <div className="rounded-2xl bg-muted/40 border border-border/60 overflow-hidden">
          <div className="flex items-center gap-3 p-3.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
              <Plane className="w-4 h-4 text-indigo-600 dark:text-indigo-400 rotate-180" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">
                {flight.destination} <span className="text-muted-foreground font-normal">→</span> {flight.origin}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {flight.airline} · {flight.returnDeparture ? formatDate(flight.returnDeparture) : ''} · {flight.returnStops === 0 ? 'Non-stop' : `${flight.returnStops ?? 0} stop${(flight.returnStops ?? 0) > 1 ? 's' : ''}`}
                {flight.returnDuration ? ` · ${flight.returnDuration}` : ''}
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full font-medium">Return</span>
          </div>

          {/* Return segment details (always visible when outbound is expanded) */}
          {flightExpanded && (
            <div className="border-t border-border/40 bg-muted/20 px-3.5 py-3 space-y-0">
              {flight.returnSegments.map((seg, i) => {
                const layover = i < flight.returnSegments!.length - 1
                  ? calcLayoverMins(seg.arrival, flight.returnSegments![i + 1].departure)
                  : null;
                return (
                  <div key={`ret-${i}`}>
                    <div className="flex items-start gap-2.5 py-2 text-xs">
                      <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-800" />
                        {(layover || i < flight.returnSegments!.length - 1) && (
                          <div className="w-px flex-1 min-h-[28px] bg-indigo-400/30 mt-1" />
                        )}
                      </div>
                      <div className="flex-1 pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-foreground">{seg.origin} → {seg.destination}</p>
                          {seg.flightNumber && (
                            <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {seg.flightNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-0.5">
                          {formatDate(seg.departure)} · {formatTime(seg.departure)} – {formatTime(seg.arrival)}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-muted-foreground/70 text-[10px]">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{seg.duration}</span>
                        </div>
                      </div>
                    </div>
                    {layover && (
                      <div className="ml-4.5 mb-1 flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-full text-[10px] font-semibold">
                          <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                          Layover in {iataToCity(seg.destination)} ({seg.destination}): {layover}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-2.5 pt-0.5">
                <div className="w-2 h-2 rounded-full bg-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800 flex-shrink-0" />
                <p className="text-[11px] font-semibold text-foreground">
                  {flight.returnSegments[flight.returnSegments.length - 1]?.destination} — {flight.returnArrival ? `${formatTime(flight.returnArrival)}, ${formatDate(flight.returnArrival)}` : ''}
                </p>
              </div>
            </div>
          )}
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

// ─── Date-of-birth picker — Year / Month / Day dropdowns ─────────────────────
// Replaces <input type="date"> which shows a broken month-by-month calendar
// on mobile with no year-jump. Dropdowns are instantly usable on all devices.
//
// CRITICAL: Uses LOCAL state for year/month/day so partial selections are
// preserved. The original bug: parent only stores a complete YYYY-MM-DD,
// so selecting "Year" while Month/Day were empty would call onChange(''),
// which reset the parent state, which re-rendered the Year dropdown back
// to empty — making every selection immediately disappear.

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Countries used for nationality selector and passport issuing country dropdown.
// ISO 3166-1 alpha-2 codes — sorted alphabetically by name.
const COUNTRIES: { code: string; name: string }[] = [
  { code: 'AR', name: 'Argentina' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EG', name: 'Egypt' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KR', name: 'South Korea' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'MA', name: 'Morocco' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'VN', name: 'Vietnam' },
];

function DOBPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;           // YYYY-MM-DD or ''
  onChange: (v: string) => void;
}) {
  // Local state — preserves partial selections independently of parent's value
  const [year,  setYear]  = useState<string>(() => value.match(/^(\d{4})-/)?.[1]       ?? '');
  const [month, setMonth] = useState<string>(() => value.match(/^\d{4}-(\d{2})-/)?.[1] ?? '');
  const [day,   setDay]   = useState<string>(() => value.match(/\d{4}-\d{2}-(\d{2})$/)?.[1] ?? '');

  // Sync from parent when value changes externally (e.g. pre-filling a saved date).
  // Only update local state when parent provides a complete YYYY-MM-DD — never clear
  // local state when value becomes '' because that would undo partial user selections
  // (the circular-reset bug: year selected → notify('') → useEffect clears year → disappears).
  useEffect(() => {
    const p = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (p) {
      setYear(p[1]); setMonth(p[2]); setDay(p[3]);
    }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1920 + 1 }, (_, i) => currentYear - i);

  // Days in the selected month/year — updates when month or year changes
  const daysInMonth = year && month
    ? new Date(parseInt(year), parseInt(month), 0).getDate()
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Notify parent only when all three fields are complete.
  // Do NOT call onChange('') for incomplete selections — that triggers the parent
  // to re-render with value='', which causes useEffect to clear local state (the
  // circular-reset bug where every selection immediately disappears).
  const notify = (y: string, m: string, d: string) => {
    if (y && m && d) {
      // Clamp day if switching to a shorter month
      const maxDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const clampedDay = Math.min(parseInt(d), maxDay).toString().padStart(2, '0');
      onChange(`${y}-${m.padStart(2, '0')}-${clampedDay}`);
    }
    // Incomplete: leave parent value as-is — validation will catch missing DOB on submit
  };

  const handleYear = (y: string) => {
    setYear(y);
    // Clamp day when year changes (leap year edge case)
    const clampedDay = (y && month && day)
      ? Math.min(parseInt(day), new Date(parseInt(y), parseInt(month), 0).getDate()).toString().padStart(2, '0')
      : day;
    if (clampedDay !== day) setDay(clampedDay);
    notify(y, month, clampedDay);
  };

  const handleMonth = (m: string) => {
    setMonth(m);
    // Clamp day when month changes (e.g. was day 31, switching to Feb)
    const clampedDay = (year && m && day)
      ? Math.min(parseInt(day), new Date(parseInt(year), parseInt(m), 0).getDate()).toString().padStart(2, '0')
      : day;
    if (clampedDay !== day) setDay(clampedDay);
    notify(year, m, clampedDay);
  };

  const handleDay = (d: string) => {
    setDay(d);
    notify(year, month, d);
  };

  const selectCls = 'w-full px-3 py-2.5 text-sm rounded-xl border border-border/80 bg-background ' +
    'text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 ' +
    'focus:border-teal-500 transition-all duration-150';

  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {/* Year */}
        <select value={year} onChange={e => handleYear(e.target.value)} className={selectCls}>
          <option value="">Year</option>
          {years.map(y => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        {/* Month */}
        <select value={month} onChange={e => handleMonth(e.target.value)} className={selectCls}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={i} value={String(i + 1).padStart(2, '0')}>{name}</option>
          ))}
        </select>
        {/* Day */}
        <select value={day} onChange={e => handleDay(e.target.value)} className={selectCls}>
          <option value="">Day</option>
          {days.map(d => (
            <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Passport expiry picker — Year / Month / Day dropdowns ───────────────────
// Same pattern as DOBPicker but year range is current year → current year + 10.
// Passport must be valid at time of travel (most countries require 6+ months
// beyond the return date). We validate in the form that expiry > today.

function PassportExpiryPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;       // YYYY-MM-DD or ''
  onChange: (v: string) => void;
}) {
  const [year,  setYear]  = useState<string>(() => value.match(/^(\d{4})-/)?.[1]       ?? '');
  const [month, setMonth] = useState<string>(() => value.match(/^\d{4}-(\d{2})-/)?.[1] ?? '');
  const [day,   setDay]   = useState<string>(() => value.match(/\d{4}-\d{2}-(\d{2})$/)?.[1] ?? '');

  useEffect(() => {
    const p = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (p) { setYear(p[1]); setMonth(p[2]); setDay(p[3]); }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear + i); // current to +10

  const daysInMonth = year && month
    ? new Date(parseInt(year), parseInt(month), 0).getDate()
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const notify = (y: string, m: string, d: string) => {
    if (y && m && d) {
      const maxDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const clampedDay = Math.min(parseInt(d), maxDay).toString().padStart(2, '0');
      onChange(`${y}-${m.padStart(2, '0')}-${clampedDay}`);
    }
  };

  const handleYear = (y: string) => {
    setYear(y);
    const clampedDay = (y && month && day)
      ? Math.min(parseInt(day), new Date(parseInt(y), parseInt(month), 0).getDate()).toString().padStart(2, '0')
      : day;
    if (clampedDay !== day) setDay(clampedDay);
    notify(y, month, clampedDay);
  };
  const handleMonth = (m: string) => {
    setMonth(m);
    const clampedDay = (year && m && day)
      ? Math.min(parseInt(day), new Date(parseInt(year), parseInt(m), 0).getDate()).toString().padStart(2, '0')
      : day;
    if (clampedDay !== day) setDay(clampedDay);
    notify(year, m, clampedDay);
  };
  const handleDay = (d: string) => { setDay(d); notify(year, month, d); };

  const selectCls = 'w-full px-3 py-2.5 text-sm rounded-xl border border-border/80 bg-background ' +
    'text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30 ' +
    'focus:border-teal-500 transition-all duration-150';

  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </label>
      <div className="grid grid-cols-3 gap-2">
        <select value={year} onChange={e => handleYear(e.target.value)} className={selectCls}>
          <option value="">Year</option>
          {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select value={month} onChange={e => handleMonth(e.target.value)} className={selectCls}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={i} value={String(i + 1).padStart(2, '0')}>{name}</option>
          ))}
        </select>
        <select value={day} onChange={e => handleDay(e.target.value)} className={selectCls}>
          <option value="">Day</option>
          {days.map(d => <option key={d} value={String(d).padStart(2, '0')}>{d}</option>)}
        </select>
      </div>
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
  const [clientSecret,    setClientSecret]    = useState('');
  const [paymentIntentId, setPaymentIntentId] = useState('');
  const [preparing,       setPreparing]       = useState(false);   // true while /api/stripe/prepare is in-flight
  const [currency,        setCurrency]        = useState<'cad' | 'usd'>('usd');
  const [payComplete,     setPayComplete]     = useState(false);
  // Total charged via Stripe = flight fare + $20 service fee (set when PI is created)
  const [stripeTotal,     setStripeTotal]     = useState(0);        // cents
  const [stripeCurrency,  setStripeCurrency]  = useState('USD');    // currency of Stripe charge
  // Confirmation state when no flight is in cart (hotel-only booking)
  const [confirmFlightless, setConfirmFlightless] = useState(false);
  // Terms & Conditions acceptance for payment
  const [termsAccepted, setTermsAccepted] = useState(false);
  // MEDIUM severity: Nationality selection — applies to all passengers
  const [nationality, setNationality] = useState('CA');

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
  //
  // onPaymentComplete fires automatically after the card is charged — the widget
  // auto-advances to confirm the hotel booking without any manual button click.
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
        s.crossOrigin = 'anonymous';
        // TODO: Add s.integrity = 'sha384-<hash>' for SRI protection — compute with:
        // curl -s https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js | openssl dgst -sha384 -binary | openssl base64 -A
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

      // Persist the data needed to complete the booking after a potential 3DS redirect.
      // If the bank redirects the customer away and back, the widget's onPaymentComplete
      // won't fire — the /booking page reads this and calls /api/complete-hotel-booking.
      try {
        const lead = passengers[0];
        sessionStorage.setItem('ft_hotel_pending', JSON.stringify({
          prebookId:      hotelPrebookId,
          transactionId:  hotelTransactionId,
          flightRef:      flightRef || undefined,
          guestFirstName: lead?.firstName ?? '',
          guestLastName:  lead?.lastName  ?? '',
          guestEmail:     lead?.email     ?? '',
          savedAt:        Date.now(),
        }));
      } catch { /* sessionStorage may be unavailable — 3DS flow degrades to manual button */ }

      LiteAPIPayment({
        publicKey:     isSandbox ? 'sandbox' : 'live',
        secretKey:     hotelSecretKey,
        targetElement: '#liteapi-payment-container',
        appearance:    'flat',
        options:       { name: 'FlexeTravels' },
        // returnUrl fires when 3D Secure redirects the customer to their bank then back.
        // The /booking page reads ft_hotel_pending from sessionStorage and completes the booking.
        returnUrl: `${window.location.origin}/booking?hotel_payment=complete&prebookId=${encodeURIComponent(hotelPrebookId)}`,
        // Auto-advance to booking confirmation the moment the card is charged.
        // Without this, customers would have to manually click a "confirm" button
        // after paying — risking abandoned bookings if they close the modal.
        onPaymentComplete: () => {
          if (!cancelled) handleHotelPayComplete();
        },
        onError: (msg: unknown) => {
          if (!cancelled) {
            setError(typeof msg === 'string' ? msg : 'Payment failed. Please try again.');
            // Reset back to hotel-payment so the widget stays visible for retry
            setPhase('hotel-payment');
          }
        },
      });
    })().catch(err => {
      if (!cancelled) {
        setError(String(err));
        setPhase('error');
      }
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // MEDIUM severity: Check for unaccompanied minors
    if (childPassengers.length > 0 && passengers.length === 0) {
      return 'At least one adult passenger is required when booking for children.';
    }

    // MEDIUM severity: Check for unaccompanied minors under 15
    for (let i = 0; i < childPassengers.length; i++) {
      const c = childPassengers[i];
      if (c.dateOfBirth && c.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const dob = new Date(c.dateOfBirth);
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear() -
                    (today.getMonth() < dob.getMonth() ||
                     (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate()) ? 1 : 0);
        if (age < 15 && passengers.length === 0) {
          return `Unaccompanied minors under 15 require special arrangements not available through online booking. Please contact the airline directly.`;
        }
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      if (!p.firstName.trim())  return `Adult ${i + 1}: first name required`;
      if (!p.lastName.trim())   return `Adult ${i + 1}: last name required`;
      if (!p.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/))
        return `Adult ${i + 1}: date of birth required`;
      if (!p.email.includes('@')) return `Adult ${i + 1}: valid email required`;
      if (!p.phone.trim())      return `Adult ${i + 1}: phone required`;
      // Passport validation — required when booking a flight
      if (flight) {
        if (!p.passportNumber.trim())
          return `Adult ${i + 1}: passport number required`;
        if (!p.passportIssuingCountry)
          return `Adult ${i + 1}: passport issuing country required`;
        if (!p.passportExpiry.match(/^\d{4}-\d{2}-\d{2}$/))
          return `Adult ${i + 1}: passport expiry date required`;
        if (new Date(p.passportExpiry) <= today)
          return `Adult ${i + 1}: passport has expired — please use a valid passport`;
      }
    }
    for (let i = 0; i < childPassengers.length; i++) {
      const c = childPassengers[i];
      if (!c.firstName.trim())  return `Child ${i + 1}: first name required`;
      if (!c.lastName.trim())   return `Child ${i + 1}: last name required`;
      if (!c.dateOfBirth.match(/^\d{4}-\d{2}-\d{2}$/))
        return `Child ${i + 1}: date of birth required`;
      // Passport validation for children on flights
      if (flight) {
        if (!c.passportNumber.trim())
          return `Child ${i + 1}: passport number required`;
        if (!c.passportIssuingCountry)
          return `Child ${i + 1}: passport issuing country required`;
        if (!c.passportExpiry.match(/^\d{4}-\d{2}-\d{2}$/))
          return `Child ${i + 1}: passport expiry date required`;
        if (new Date(c.passportExpiry) <= today)
          return `Child ${i + 1}: passport has expired — please use a valid passport`;
      }
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
    const adultBase: Passenger[] = [
      { firstName: 'John',  lastName: 'Doe',   dateOfBirth: '1990-01-15', email: 'test@flexetravels.com',  phone: '+14165551234', title: 'mr', gender: 'm', passportNumber: 'AB123456', passportIssuingCountry: 'CA', passportExpiry: '2029-06-30' },
      { firstName: 'Jane',  lastName: 'Doe',   dateOfBirth: '1992-03-22', email: 'test2@flexetravels.com', phone: '+14165551235', title: 'ms', gender: 'f', passportNumber: 'CD789012', passportIssuingCountry: 'CA', passportExpiry: '2028-09-15' },
      { firstName: 'Alice', lastName: 'Smith', dateOfBirth: '1985-07-04', email: 'test3@flexetravels.com', phone: '+14165551236', title: 'ms', gender: 'f', passportNumber: 'EF345678', passportIssuingCountry: 'CA', passportExpiry: '2027-12-31' },
      { firstName: 'Bob',   lastName: 'Smith', dateOfBirth: '1983-11-30', email: 'test4@flexetravels.com', phone: '+14165551237', title: 'mr', gender: 'm', passportNumber: 'GH901234', passportIssuingCountry: 'CA', passportExpiry: '2030-03-22' },
    ];
    const childBase: ChildPassenger[] = [
      { firstName: 'Emma',  lastName: 'Doe',   dateOfBirth: '2016-06-10', gender: 'f', passportNumber: 'IJ567890', passportIssuingCountry: 'CA', passportExpiry: '2028-06-10' },
      { firstName: 'Liam',  lastName: 'Doe',   dateOfBirth: '2018-11-22', gender: 'm', passportNumber: 'KL123456', passportIssuingCountry: 'CA', passportExpiry: '2027-11-22' },
      { firstName: 'Olivia',lastName: 'Smith', dateOfBirth: '2019-03-05', gender: 'f', passportNumber: 'MN789012', passportIssuingCountry: 'CA', passportExpiry: '2029-03-05' },
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
    // Validation passed — go to invoice review step (no API calls yet)
    setPhase('invoice');
  }, [passengers, adults, children, childPassengers, flight, hotel]);

  // ── Proceed to payment (Invoice → Pay) ────────────────────────────────────────
  // Creates a Stripe PaymentIntent for (flight fare + $20 service fee).
  // The flight fare is charged here so FlexeTravels collects the full ticket cost
  // before booking the Duffel flight from their account balance.
  const handleProceedToPayment = useCallback(async () => {
    setPreparing(true);
    setError('');
    try {
      // Compute the flight price in the smallest currency unit (cents)
      const flightPriceCents = flight ? Math.round((flight.price ?? 0) * 100) : 0;
      const flightCurrency   = flight?.currency ?? 'USD';
      const flightDesc       = flight
        ? `${flight.origin} → ${flight.destination} (${flight.airline})`
        : undefined;

      const res  = await fetch('/api/stripe/prepare', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingReference:  `pre_${Date.now()}`,
          customerEmail:     passengers[0]?.email,
          flightOfferId:     flight?.id ?? undefined,
          flightPriceCents,
          flightCurrency,
          flightDescription: flightDesc,
          hotelTotalCents: hotel ? Math.round((hotel.totalPrice ?? 0) * 100) : undefined,
          passengerCount: adults + children,
        }),
      });
      const data = await res.json() as {
        clientSecret?: string;
        paymentIntentId?: string;
        error?: string;
        breakdown?: { flightCents: number; serviceFeeCents: number; totalCents: number; currency: string };
      };
      if (!res.ok || !data.clientSecret) {
        setError(data.error ?? 'Payment setup failed. Please try again.');
        setPhase('error');
        return;
      }
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId ?? '');
      // Store the total for display on the payment screen
      setStripeTotal(data.breakdown?.totalCents ?? flightPriceCents + 2000);
      setStripeCurrency((data.breakdown?.currency ?? flightCurrency).toUpperCase());
      setPhase('payment');
    } catch (e) {
      setError(`Network error: ${String(e)}`);
      setPhase('error');
    } finally {
      setPreparing(false);
    }
  }, [passengers, flight, hotel, adults, children]);

  // ── Pay → then Book ──────────────────────────────────────────────────────────
  // 1. Confirm payment with Stripe
  // 2. On success: call /api/book-trip with paymentIntentId as proof
  // 3. Handle booking result (flight ref, hotel ref, LiteAPI SDK, etc.)
  const handlePay = useCallback(async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setError('');

    const { error: submitErr } = await elementsRef.current.submit();
    if (submitErr) { setError(submitErr.message); return; }

    const result = await stripeRef.current.confirmPayment({
      elements:      elementsRef.current,
      confirmParams: { return_url: `${window.location.origin}/booking?fee_paid=true` },
      redirect:      'if_required',
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    // ── Payment confirmed — now book the actual trip ───────────────────────────
    mountRef.current?.unmount();
    setPhase('booking');

    const flightId   = flight?.id;
    const hotelToken = hotel?.bookingToken ?? '';
    const PH_RE      = /^(<.*>|N\/A|TBD|pending|unknown|loading|undefined|null|example|test|sample)$/i;
    const hasValidFlightId = !!(
      flightId && !flightId.startsWith('<') && flightId.length >= 6 && !PH_RE.test(flightId.trim())
    );
    const hasValidHotelToken = !!(
      hotelToken && hotelToken.startsWith('liteapi_') &&
      hotelToken.replace('liteapi_', '').length >= 6 &&
      !PH_RE.test(hotelToken.replace('liteapi_', '').trim())
    );

    try {
      const res = await fetch('/api/book-trip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          paymentIntentId,                          // proof of payment — server verifies this
          flightOfferId:       hasValidFlightId  ? flightId   : undefined,
          requestedPriceCents: flight?.price ? Math.round(flight.price * 100) : undefined,
          flightOrigin:        flight?.origin,
          flightDestination:   flight?.destination,
          flightDepartureDate: flight?.departure ? flight.departure.slice(0, 10) : undefined,
          flightCabinClass:    flight?.cabinClass ?? 'economy',
          flightPassengers:    flight?.passengers ?? adults,
          hotelRateId:         hasValidHotelToken ? hotelToken : undefined,
          hotelName:           hotel?.name,
          hotelId:             hotel?.id,
          hotelCheckIn:        hotel?.checkIn,
          hotelCheckOut:       hotel?.checkOut,
          passengers:          passengers.slice(0, adults),
          childPassengers:     childPassengers.slice(0, children),
          originAirport:       flight?.origin ?? '',
          guestNationality:    nationality,
        }),
      });

      const data = await res.json() as {
        success:               boolean;
        priceChanged?:         boolean;
        newPriceCents?:        number;
        flightRef?:            string;
        hotelRef?:             string;
        flightError?:          string;
        hotelError?:           string;
        currency?:             'cad' | 'usd';
        error?:                string;
        requiresHotelPayment?: boolean;
        hotelPrebookId?:       string;
        hotelSecretKey?:       string;
        hotelTransactionId?:   string;
        isSandboxBooking?:     boolean;
      };

      if (!res.ok || !data.success) {
        // Payment succeeded but booking failed — IMPORTANT: tell user their card was charged
        const chargedAmt = stripeTotal > 0
          ? formatPrice(stripeTotal / 100, stripeCurrency)
          : 'the service fee';
        setError(
          (data.error ?? data.flightError ?? data.hotelError ?? 'Booking failed.') +
          ` Your card was charged ${chargedAmt}. Please contact support@flexetravels.com with your payment reference.`,
        );
        setPhase('error');
        return;
      }

      if (data.flightRef) setFlightRef(data.flightRef);
      if (data.hotelRef)  setHotelRef(data.hotelRef);
      if (data.currency)  setCurrency(data.currency);

      // Production hotel payment via LiteAPI SDK
      if (data.requiresHotelPayment && data.hotelPrebookId && data.hotelSecretKey) {
        setHotelPrebookId(data.hotelPrebookId);
        setHotelSecretKey(data.hotelSecretKey);
        setHotelTransactionId(data.hotelTransactionId ?? '');
        setPhase('hotel-payment');
        return;
      }

      // Hotel expected but server skipped (sandbox limitation)
      if (hotel?.bookingToken && !data.hotelRef && !data.requiresHotelPayment) {
        setError(
          (data.hotelError ?? `Hotel booking failed for ${hotel.name}.`) +
          ` Your flight (${data.flightRef ?? 'ref pending'}) was reserved. ` +
          `Contact support@flexetravels.com — your $20 fee was charged.`,
        );
        setPhase('error');
        return;
      }

      setPhase('success');
      onConfirmed?.(data.flightRef, data.hotelRef);

      // Send confirmation email (non-blocking)
      fetch('/api/send-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flightRef: data.flightRef ?? flightRef,
          hotelRef: data.hotelRef ?? hotelRef,
          flight,
          hotel,
          passengers: passengers.slice(0, adults),
          childPassengers: childPassengers.slice(0, children),
          adults,
          children,
          currency: data.currency ?? 'USD',
          serviceFee: 20,
          bookedAt: new Date().toISOString(),
        }),
      }).catch(e => console.warn('[checkout] Confirmation email failed:', e));
    } catch (e) {
      const chargedAmt = stripeTotal > 0
        ? formatPrice(stripeTotal / 100, stripeCurrency)
        : 'your payment';
      setError(
        `Network error: ${String(e)}. ` +
        `${chargedAmt} was charged — please contact support@flexetravels.com.`,
      );
      setPhase('error');
    }
  }, [paymentIntentId, stripeTotal, stripeCurrency, sessionId, flight, hotel, passengers, adults, children, childPassengers, nationality, onConfirmed]);

  // Service fee is always USD $20 — Stripe PaymentIntent is created in USD
  const feeDisplay = formatPrice(20, 'USD');

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
          {stripeTotal > 0
            ? `${formatPrice(stripeTotal / 100, stripeCurrency)} charged securely`
            : `Service fee of ${feeDisplay} processed`
          } · PCI-DSS compliant payment
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-2">
          Questions or complaints? Contact us at{' '}
          <a href="mailto:support@flexetravels.com" className="underline">support@flexetravels.com</a>
          {' '}· US DOT complaint line: 1-202-366-2220
        </p>
        <div className="mt-3 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
          <p className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">
            ✈️ Under US DOT rules, you may cancel your flight free of charge within 24 hours of booking,
            provided departure is 7+ days away.
          </p>
        </div>
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
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-teal-500" />
          <h2 className="font-black text-base text-foreground tracking-tight">Secure Checkout</h2>
        </div>
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

            {/* Price-change alert — shown when live Duffel price differs from search price */}
            {error && error.startsWith('⚠️ Price updated') && (
              <div className="rounded-xl border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-1.5">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <span>⚠️</span> Flight price has changed
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  {error.replace('⚠️ Price updated: ', '')}
                </p>
              </div>
            )}

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

            {/* Cost overview — full breakdown shown on Invoice step */}
            <div className="border-t border-border/40 pt-3 space-y-1.5">
              {flight && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Flight ({flight.origin} → {flight.destination})</span>
                  <span>{formatPrice(flight.price, flight.currency)}</span>
                </div>
              )}
              {hotel && !hotel.isSample && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Hotel ({hotel.name})</span>
                  <span>{formatPrice(hotel.totalPrice, hotel.currency)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  FlexeTravels service fee
                </div>
                <span className="text-teal-700 dark:text-teal-300 font-bold">{feeDisplay}</span>
              </div>
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
              Full invoice shown before payment · Secured by Stripe
            </p>
          </div>
        )}

        {/* ── Step 2: Passengers ─────────────────────────────────────────────── */}
        {phase === 'passengers' && (
          <div className="flex flex-col gap-0">
            {/* Scrollable form area — button stays visible below */}
            <div className="space-y-5 overflow-y-auto max-h-[52vh] pr-1
                            [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">
              {/* Passport accuracy disclaimer */}
              <div className="rounded-xl border border-amber-400/30 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                  </svg>
                  Enter details exactly as they appear on your passport
                </p>
                <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                  Name spelling, date of birth, and gender must match your travel document precisely.
                  Incorrect information may result in denied boarding or refused check-in.
                  FlexeTravels cannot be held responsible for errors entered by the traveller.
                </p>
              </div>

              {/* Privacy notice — PIPEDA/CCPA compliance */}
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed px-1">
                Your personal information is collected to process your booking and is handled in accordance with our{' '}
                <a href="/privacy" className="underline hover:text-teal-600 transition-colors">Privacy Policy</a>.
                We share your details only with airlines and hotels to complete your reservation.
              </p>

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

              {/* MEDIUM severity: Nationality selector — applies to all passengers */}
              <div className="space-y-1.5 pl-1">
                <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Nationality (all passengers)
                </label>
                <select
                  value={nationality}
                  onChange={e => setNationality(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                             bg-background text-foreground focus:outline-none focus:ring-2
                             focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>

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
                  {/* Title & Gender — TSA Secure Flight requirement */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Title</label>
                      <select
                        value={pax.title}
                        onChange={e => updatePassenger(i, 'title', e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                                   bg-background text-foreground focus:outline-none focus:ring-2
                                   focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                      >
                        <option value="mr">Mr</option>
                        <option value="ms">Ms</option>
                        <option value="mrs">Mrs</option>
                        <option value="miss">Miss</option>
                        <option value="dr">Dr</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Gender</label>
                      <select
                        value={pax.gender}
                        onChange={e => updatePassenger(i, 'gender', e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                                   bg-background text-foreground focus:outline-none focus:ring-2
                                   focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                      >
                        <option value="m">Male</option>
                        <option value="f">Female</option>
                      </select>
                    </div>
                  </div>
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
                  <DOBPicker
                    label="Date of Birth"
                    value={pax.dateOfBirth}
                    onChange={v => updatePassenger(i, 'dateOfBirth', v)}
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

                  {/* ── Passport / Travel Document ─────────────────────────── */}
                  {flight && (
                    <div className="space-y-3 pt-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 4a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm2 0h10v12H5V4zm2 3a1 1 0 000 2h6a1 1 0 000-2H7zm0 3a1 1 0 000 2h4a1 1 0 000-2H7z" clipRule="evenodd" />
                        </svg>
                        Passport / Travel Document
                      </p>
                      <Field
                        label="Passport Number"
                        value={pax.passportNumber}
                        onChange={v => updatePassenger(i, 'passportNumber', v.toUpperCase())}
                        placeholder="e.g. AB 123456"
                      />
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                          Issuing Country
                        </label>
                        <select
                          value={pax.passportIssuingCountry}
                          onChange={e => updatePassenger(i, 'passportIssuingCountry', e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                                     bg-background text-foreground focus:outline-none focus:ring-2
                                     focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                        >
                          {COUNTRIES.map(c => (
                            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                          ))}
                        </select>
                      </div>
                      <PassportExpiryPicker
                        label="Expiry Date"
                        value={pax.passportExpiry}
                        onChange={v => updatePassenger(i, 'passportExpiry', v)}
                      />
                    </div>
                  )}
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
                  {/* Gender — TSA Secure Flight */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Gender</label>
                    <select
                      value={child.gender}
                      onChange={e => updateChildPassenger(i, 'gender', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                                 bg-background text-foreground focus:outline-none focus:ring-2
                                 focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                    >
                      <option value="m">Male</option>
                      <option value="f">Female</option>
                    </select>
                  </div>
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
                    <DOBPicker
                      label="Date of Birth"
                      value={child.dateOfBirth}
                      onChange={v => updateChildPassenger(i, 'dateOfBirth', v)}
                    />
                    <div className="mt-1.5">
                      <ChildAgeBadge dob={child.dateOfBirth} />
                    </div>
                  </div>

                  {/* ── Passport / Travel Document ─────────────────────────── */}
                  {flight && (
                    <div className="space-y-3 pt-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 4a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm2 0h10v12H5V4zm2 3a1 1 0 000 2h6a1 1 0 000-2H7zm0 3a1 1 0 000 2h4a1 1 0 000-2H7z" clipRule="evenodd" />
                        </svg>
                        Passport / Travel Document
                      </p>
                      <Field
                        label="Passport Number"
                        value={child.passportNumber}
                        onChange={v => updateChildPassenger(i, 'passportNumber', v.toUpperCase())}
                        placeholder="e.g. AB 123456"
                      />
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                          Issuing Country
                        </label>
                        <select
                          value={child.passportIssuingCountry}
                          onChange={e => updateChildPassenger(i, 'passportIssuingCountry', e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border/80
                                     bg-background text-foreground focus:outline-none focus:ring-2
                                     focus:ring-teal-500/30 focus:border-teal-500 transition-all duration-150"
                        >
                          {COUNTRIES.map(c => (
                            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                          ))}
                        </select>
                      </div>
                      <PassportExpiryPicker
                        label="Expiry Date"
                        value={child.passportExpiry}
                        onChange={v => updateChildPassenger(i, 'passportExpiry', v)}
                      />
                    </div>
                  )}
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
                Review &amp; Pay <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Invoice (trip + passenger summary before payment) ───────── */}
        {phase === 'invoice' && (
          <div className="flex flex-col gap-0">
            {/* Scrollable invoice area */}
            <div className="space-y-4 overflow-y-auto max-h-[55vh] pr-1
                            [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">

              {/* ── Trip summary ─────────────────────────────────────────── */}
              <TripRow flight={flight} hotel={hotel} />

              {/* ── Passenger details (full, for verification) ──────────── */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Passengers
                </p>
                {passengers.map((pax, i) => (
                  <div key={`inv-adult-${i}`} className="p-3 rounded-xl bg-muted/30 border border-border/50 space-y-0.5">
                    <p className="text-sm font-bold text-foreground">
                      {pax.firstName} {pax.lastName}
                      <span className="ml-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {i === 0 ? 'Lead' : `Adult ${i + 1}`}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">DOB: {pax.dateOfBirth}</p>
                    <p className="text-xs text-muted-foreground">{pax.email} · {pax.phone}</p>
                    {pax.passportNumber && (
                      <p className="text-xs text-muted-foreground">
                        Passport: {pax.passportNumber} · {pax.passportIssuingCountry} · Exp: {pax.passportExpiry}
                      </p>
                    )}
                  </div>
                ))}
                {childPassengers.map((child, i) => (
                  <div key={`inv-child-${i}`} className="p-3 rounded-xl bg-muted/30 border border-border/50 space-y-0.5">
                    <p className="text-sm font-bold text-foreground">
                      {child.firstName} {child.lastName}
                      <span className="ml-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Child {i + 1}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">DOB: {child.dateOfBirth}</p>
                    {child.passportNumber && (
                      <p className="text-xs text-muted-foreground">
                        Passport: {child.passportNumber} · {child.passportIssuingCountry} · Exp: {child.passportExpiry}
                      </p>
                    )}
                    <ChildAgeBadge dob={child.dateOfBirth} />
                  </div>
                ))}
              </div>

              {/* ── Cost breakdown ───────────────────────────────────────── */}
              <div className="border border-border/50 rounded-xl overflow-hidden">
                {/* ── Card charge section ────────────────────────── */}
                <div className="px-3 pt-3 pb-2 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Charged to your card now
                  </p>
                  {flight && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          ✈ Flight · {flight.airline} · {flight.origin} → {flight.destination}
                        </span>
                        <span className="font-semibold text-foreground flex-shrink-0 ml-2">
                          {formatPrice(flight.price, flight.currency)}
                        </span>
                      </div>
                      {/* MEDIUM severity: Child pricing disclosure */}
                      {children > 0 && flight && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">
                          Note: Child fares may differ from adult pricing shown. Final child seat prices are confirmed at booking time by the airline.
                        </p>
                      )}
                    </div>
                  )}
                  {!flight && (
                    <p className="text-xs text-muted-foreground italic">No flight selected</p>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">FlexeTravels service fee</span>
                    <span className="font-semibold text-teal-700 dark:text-teal-300 flex-shrink-0 ml-2">{feeDisplay}</span>
                  </div>
                  {flight && (
                    <div className="flex justify-between text-xs border-t border-border/40 pt-2 mt-1">
                      <span className="font-bold text-foreground">Total charged via card</span>
                      <span className="font-black text-foreground flex-shrink-0 ml-2">
                        {formatPrice((flight.price ?? 0) + 20, flight.currency)}
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Hotel — separate payment ──────────────────── */}
                {hotel && !hotel.isSample && (
                  <div className="px-3 pt-2 pb-3 border-t border-border/40 bg-muted/20 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Hotel — paid separately after booking
                    </p>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        🏨 {hotel.name} · {hotel.checkIn} → {hotel.checkOut}
                      </span>
                      <span className="font-semibold text-foreground flex-shrink-0 ml-2">
                        {formatPrice(hotel.totalPrice, hotel.currency)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                      Hotel payment is processed via a secure gateway after your flight is confirmed.
                      You will enter card details again for the hotel cost only.
                    </p>
                  </div>
                )}
              </div>

              {/* ── What happens next ────────────────────────────────────── */}
              <div className="rounded-xl bg-teal-50/60 dark:bg-teal-950/20 border border-teal-200/50 dark:border-teal-800/40 px-3 py-2.5 space-y-1.5">
                <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">
                  What happens after you pay
                </p>
                <ol className="text-xs text-teal-700/80 dark:text-teal-400/70 leading-relaxed space-y-0.5 list-decimal list-inside">
                  <li>
                    Your card is charged{' '}
                    <strong>{formatPrice((flight?.price ?? 0) + 20, flight?.currency ?? 'USD')}</strong>
                    {' '}(flight fare + {feeDisplay} service fee).
                  </li>
                  <li>We instantly confirm your flight with {flight?.airline ?? 'the airline'}.</li>
                  {hotel && !hotel.isSample && (
                    <li>
                      You&apos;ll complete hotel payment ({formatPrice(hotel.totalPrice, hotel.currency)}) via a secure gateway.
                    </li>
                  )}
                  <li>
                    Confirmation sent to <strong>{passengers[0]?.email || 'your email'}</strong>.
                  </li>
                </ol>
              </div>

            </div>{/* end scrollable invoice area */}

            {error && (
              <div className="flex items-start gap-2 p-3 mt-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {/* Terms & Conditions acceptance — consumer protection */}
            <div className="pt-3 border-t border-border/30 mt-3">
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border accent-teal-600"
                />
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  I agree to FlexeTravels'{' '}
                  <a href="/terms" className="underline hover:text-teal-600">Terms of Service</a>
                  {' '}and acknowledge the{' '}
                  <a href="/privacy" className="underline hover:text-teal-600">Privacy Policy</a>.
                  I understand the $20 service fee is non-refundable and flight cancellation rights under US DOT regulations.
                </span>
              </label>
            </div>

            <div className="flex gap-3 pt-4 border-t border-border/30 mt-3">
              <button
                onClick={() => { setPhase('passengers'); setError(''); }}
                className="flex items-center gap-1.5 px-4 py-3 rounded-2xl border border-border/80
                           text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Edit
              </button>
              <button
                onClick={() => void handleProceedToPayment()}
                disabled={preparing || !termsAccepted}
                className={cn(
                  'flex-1 py-3.5 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-all duration-150',
                  preparing
                    ? 'bg-teal-600/70 cursor-wait'
                    : 'bg-teal-600 hover:bg-teal-700 active:scale-[0.98] shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30'
                )}
              >
                {preparing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up payment…</>
                  : <><Lock className="w-4 h-4" /> Pay {formatPrice((flight?.price ?? 0) + 20, flight?.currency ?? 'USD')} <ArrowRight className="w-4 h-4" /></>
                }
              </button>
            </div>
            <p className="text-center text-[10px] text-muted-foreground/50 mt-1">
              Secured by Stripe · PCI-DSS compliant · We never store your card details
            </p>
          </div>
        )}

        {/* ── Step 4: Stripe payment form ────────────────────────────────────── */}
        {phase === 'payment' && (
          <div className="space-y-4">
            {/* Breakdown of exactly what this card charge covers */}
            <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-1.5 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" /> Charging to your card now
              </p>
              {flight && (
                <div className="flex justify-between text-muted-foreground">
                  <span>✈ Flight · {flight.origin} → {flight.destination} ({flight.airline})</span>
                  <span className="font-semibold text-foreground ml-2 flex-shrink-0">{formatPrice(flight.price, flight.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>FlexeTravels service fee</span>
                <span className="font-semibold text-teal-700 dark:text-teal-300 ml-2 flex-shrink-0">{feeDisplay}</span>
              </div>
              <div className="flex justify-between border-t border-border/40 pt-1.5 mt-0.5">
                <span className="font-bold text-foreground">Total charged now</span>
                <span className="font-black text-foreground ml-2 flex-shrink-0">
                  {stripeTotal > 0
                    ? formatPrice(stripeTotal / 100, stripeCurrency)
                    : formatPrice((flight?.price ?? 0) + 20, flight?.currency ?? 'USD')}
                </span>
              </div>
              {hotel && !hotel.isSample && (
                <div className="pt-1 border-t border-border/30 flex justify-between text-muted-foreground/70">
                  <span>🏨 Hotel paid separately after booking</span>
                  <span className="ml-2 flex-shrink-0">{formatPrice(hotel.totalPrice, hotel.currency)}</span>
                </div>
              )}
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
              Pay {stripeTotal > 0
                ? formatPrice(stripeTotal / 100, stripeCurrency)
                : formatPrice((flight?.price ?? 0) + 20, flight?.currency ?? 'USD')} securely
            </button>
            <p className="text-center text-[10px] text-muted-foreground/50">
              256-bit encrypted payment · PCI-DSS compliant · Card details never stored
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

            <div className="rounded-xl bg-muted/30 border border-border/50 p-3 space-y-1.5 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Payment summary</p>
              {stripeTotal > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>✅ Flight + service fee (already paid)</span>
                  <span className="font-semibold text-foreground ml-2 flex-shrink-0">
                    {formatPrice(stripeTotal / 100, stripeCurrency)}
                  </span>
                </div>
              )}
              {hotel && !hotel.isSample && (
                <div className="flex justify-between">
                  <span className="text-foreground font-semibold">🏨 Hotel payment due now</span>
                  <span className="font-black text-foreground ml-2 flex-shrink-0">
                    {formatPrice(hotel.totalPrice, hotel.currency)}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Enter card details for hotel</p>
              <p className="text-xs text-muted-foreground">
                This charge covers your hotel stay only. Payment is processed securely — FlexeTravels never stores your card data.
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

            {/* Fallback button — shown only if the widget's onPaymentComplete
                didn't fire (e.g. 3DS redirect flow that returned to this page) */}
            {phase === 'hotel-payment' && (
              <button
                onClick={handleHotelPayComplete}
                className={cn(
                  'w-full py-3 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2',
                  'bg-muted text-muted-foreground border border-border/60',
                  'hover:bg-muted/80 transition-all duration-150'
                )}
              >
                <Lock className="w-3 h-3" />
                Payment complete — confirm my booking
              </button>
            )}
            <p className="text-center text-[10px] text-muted-foreground/50">
              Hotel payment processed securely · 256-bit encrypted · PCI-DSS compliant
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
