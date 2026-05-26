'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, Building2, CalendarDays, CheckCircle2, CreditCard, Filter, Hotel,
  Loader2, Lock, Minus, Plane, Plus, Search, ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react';
import { FlightCard } from '@/components/FlightCard';
import { HotelCard } from '@/components/HotelCard';
import { HotelDetailModal } from '@/components/HotelDetailModal';
import { createBookingCart, parseTravelerAges } from '@/lib/booking-funnel';
import { cn, formatPrice, generateSessionId } from '@/lib/utils';
import type { FlightResult, HotelResult } from '@/lib/types';

type ActiveTab = 'flights' | 'hotels';
type TripType = 'round_trip' | 'one_way';
type FlightSort = 'price' | 'duration' | 'departure' | 'stops';
type StopFilter = 'all' | '0' | '1' | '2+';
type DepartWindow = 'all' | 'morning' | 'afternoon' | 'evening';
type HotelSort = 'price' | 'rating' | 'stars' | 'reviews' | 'distance';

interface FlightSearchResponse {
  flights: FlightResult[];
  sources: string[];
  errors: string[];
  publicMessages?: string[];
  issueCount?: number;
  latencyMs: number;
  error?: string;
}

interface HotelSearchResponse {
  hotels: HotelResult[];
  sources: string[];
  errors: string[];
  publicMessages?: string[];
  issueCount?: number;
  latencyMs: number;
  noResultsMessage?: string;
  error?: string;
}

const SEARCH_SESSION_KEY = 'ft_search_session';
const WEB_SESSION_ID_KEY = 'ft_session';

function getWebSessionId(): string {
  if (typeof window === 'undefined') return `web_${Date.now()}`;
  try {
    const existing = window.localStorage.getItem(WEB_SESSION_ID_KEY);
    if (existing) return existing;
    const next = `web_${generateSessionId()}`;
    window.localStorage.setItem(WEB_SESSION_ID_KEY, next);
    return next;
  } catch {
    return `web_${Date.now()}`;
  }
}

interface SearchSessionSnapshot {
  activeTab?: ActiveTab;
  flightForm?: {
    tripType: TripType;
    origin: string;
    destination: string;
    departureDate: string;
    returnDate: string;
    adults: number;
    children: number;
    childAgesText: string;
    cabinClass: (typeof cabinOptions)[number]['value'];
  };
  hotelForm?: {
    destination: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    childAgesText: string;
  };
  flights?: FlightResult[];
  hotels?: HotelResult[];
  flightMeta?: SearchMeta | null;
  hotelMeta?: (SearchMeta & { noResultsMessage?: string }) | null;
  selectedFlight?: FlightResult | null;
  selectedHotel?: HotelResult | null;
  filters?: {
    flightSort: FlightSort;
    stopFilter: StopFilter;
    airlineFilter: string;
    departWindow: DepartWindow;
    maxFlightPrice: string;
    refundableOnly: boolean;
    baggageOnly: boolean;
    hotelSort: HotelSort;
    starFilter: string;
    maxHotelPrice: string;
    refundableHotelOnly: boolean;
    minHotelRating: string;
    minHotelReviews: string;
    hotelDistance: string;
    petFriendlyHotelOnly: boolean;
    poolHotelOnly: boolean;
    parkingHotelOnly: boolean;
    familyHotelOnly: boolean;
  };
}

interface SearchMeta {
  sources: string[];
  latencyMs: number;
  publicMessages: string[];
  issueCount?: number;
  errors?: string[];
}

function normalizeSavedMeta<T extends SearchMeta>(meta: T | null | undefined, kind: ActiveTab): T | null | undefined {
  if (!meta) return meta;
  const legacyIssueCount = meta.issueCount ?? meta.errors?.length;
  const fallbackMessage = kind === 'hotels'
    ? 'Some live hotel sources did not respond. We are showing the best available options we could verify.'
    : 'Some live fare sources did not respond. We are showing the best available options we could verify.';

  return {
    ...meta,
    publicMessages: meta.publicMessages?.length
      ? meta.publicMessages
      : legacyIssueCount
        ? [fallbackMessage]
        : [],
    issueCount: legacyIssueCount,
    errors: [],
  };
}

const cabinOptions = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
] as const;

function dateOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseYmd(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toYmd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysYmd(value: string, days: number) {
  const date = parseYmd(value);
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

function formatTripDate(value: string) {
  const date = parseYmd(value);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

function nightsBetween(start: string, end: string) {
  const ms = parseYmd(end).getTime() - parseYmd(start).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

function durationMinutes(duration?: string) {
  if (!duration) return 999_999;
  const h = duration.match(/(\d+)h/)?.[1] ?? '0';
  const m = duration.match(/(\d+)m/)?.[1] ?? '0';
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

function hourOf(iso?: string) {
  if (!iso) return -1;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? -1 : d.getHours();
}

function departWindowMatches(flight: FlightResult, window: DepartWindow) {
  if (window === 'all') return true;
  const h = hourOf(flight.departure);
  if (window === 'morning') return h >= 5 && h < 12;
  if (window === 'afternoon') return h >= 12 && h < 17;
  return h >= 17 || (h >= 0 && h < 5);
}

function ageFieldValues(value: string, count: number) {
  const parts = value.split(',').map(v => v.trim());
  return Array.from({ length: count }, (_, i) => parts[i] ?? '');
}

function updateAgeField(value: string, count: number, index: number, rawAge: string) {
  const parts = ageFieldValues(value, count);
  parts[index] = rawAge;
  return parts.join(', ');
}

function maxStops(flight: FlightResult) {
  return Math.max(flight.stops, flight.isRoundTrip ? (flight.returnStops ?? 0) : 0);
}

function amenityMatches(hotel: HotelResult, terms: string[]) {
  const haystack = [
    hotel.name,
    hotel.description,
    hotel.location,
    ...(hotel.amenities ?? []),
    ...(hotel.allRoomTypes ?? []).flatMap(room => [
      room.name,
      ...(room.rates ?? []).flatMap(rate => [rate.name, rate.boardName, rate.boardType]),
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.some(term => haystack.includes(term));
}

function distanceKm(hotel: HotelResult) {
  const raw = hotel.distanceCenter?.toLowerCase() ?? '';
  const match = raw.match(/([\d.]+)\s*(km|mi|mile|miles)?/);
  if (!match) return Infinity;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return Infinity;
  return match[2]?.startsWith('mi') ? value * 1.609 : value;
}

function canEvaluateAmenities(hotel: HotelResult) {
  return Boolean(
    hotel.description ||
    hotel.amenities?.length ||
    hotel.allRoomTypes?.some(room =>
      room.name ||
      room.rates?.some(rate => rate.name || rate.boardName || rate.boardType),
    ),
  );
}

function TopNav({
  activeTab,
  onTabChange,
}: {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}) {
  const goToTab = (tab: ActiveTab) => {
    onTabChange(tab);
    const nextUrl = `/?tab=${tab}#search`;
    window.history.replaceState(null, '', nextUrl);
    window.requestAnimationFrame(() => {
      document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:h-15 lg:px-8">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0d8a62] text-white shadow-sm shadow-[#0d8a62]/20">
            <Plane className="h-4 w-4" />
          </div>
          <span className="truncate text-sm font-black tracking-tight text-white sm:text-base">
            Flexe<span className="text-[#35d49a]">Travels</span>
          </span>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:gap-1" aria-label="Primary">
          {[
            ['Flights', 'flights'],
            ['Hotels', 'hotels'],
          ].map(([label, tab]) => (
            <button
              key={label}
              type="button"
              onClick={() => goToTab(tab as ActiveTab)}
              className={cn(
                'rounded-lg px-2 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm',
                activeTab === tab
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-300 hover:bg-white/10 hover:text-white',
              )}
            >
              {label}
            </button>
          ))}
          <Link
            href="/contact"
            className="rounded-lg px-2 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white sm:px-3 sm:text-sm"
          >
            Support
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-zinc-300 hover:bg-white/10 hover:text-white lg:block">
            Sign in
          </Link>
          <a
            href={`/?tab=${activeTab}#search`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d8a62] px-3 py-2 text-sm font-bold text-white shadow-sm shadow-[#0d8a62]/20 transition hover:bg-[#0a6e50] sm:gap-2 sm:px-4"
          >
            <span className="hidden sm:inline">Search</span><Search className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}

function Field({
  label,
  children,
  className,
  tone = 'light',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className={cn(
        'mb-1.5 block text-xs font-bold uppercase tracking-wide',
        tone === 'dark' ? 'text-zinc-300' : 'text-zinc-400',
      )}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass = 'h-12 w-full rounded-lg border border-zinc-700 bg-[#111512] px-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-[#0d8a62] focus:ring-2 focus:ring-[#0d8a62]/25';
const searchInputClass = 'h-12 w-full rounded-lg border border-zinc-700 bg-[#111512] px-3 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-[#0d8a62] focus:ring-2 focus:ring-[#0d8a62]/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500';
const stepperButtonClass = 'flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-[#111512] text-zinc-200 transition hover:border-[#0d8a62] hover:text-[#35d49a] disabled:cursor-not-allowed disabled:opacity-40';

function DateInput({
  value,
  onChange,
  min,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  ariaLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if ('showPicker' in input) input.showPicker();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={cn(searchInputClass, 'pr-11')}
        type="date"
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        onClick={openPicker}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={openPicker}
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-[#35d49a]"
        aria-label={`Open ${ariaLabel.toLowerCase()} calendar`}
      >
        <CalendarDays className="h-4 w-4" />
      </button>
    </div>
  );
}

function HotelDateRangePicker({
  checkIn,
  checkOut,
  onCheckInChange,
  onCheckOutChange,
}: {
  checkIn: string;
  checkOut: string;
  onCheckInChange: (value: string) => void;
  onCheckOutChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectingCheckout, setSelectingCheckout] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseYmd(checkIn);
    date.setDate(1);
    return date;
  });
  const pickerRef = useRef<HTMLDivElement>(null);
  const today = dateOffset(1);
  const stayNights = nightsBetween(checkIn, checkOut);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openCalendar = (mode: 'checkin' | 'checkout') => {
    const month = parseYmd(mode === 'checkin' ? checkIn : checkOut);
    month.setDate(1);
    setVisibleMonth(month);
    setSelectingCheckout(mode === 'checkout');
    setOpen(true);
  };

  const chooseDate = (value: string) => {
    if (value < today) return;
    if (!selectingCheckout || value <= checkIn) {
      onCheckInChange(value);
      onCheckOutChange(addDaysYmd(value, 1));
      setSelectingCheckout(true);
      return;
    }
    onCheckOutChange(value);
    setOpen(false);
    setSelectingCheckout(false);
  };

  const renderMonth = (monthDate: Date) => {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const leading = first.getDay();
    const cells: Array<string | null> = [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => toYmd(new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1))),
    ];

    return (
      <div className="min-w-0">
        <div className="mb-2 text-center text-sm font-black text-white">{monthLabel(monthDate)}</div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-zinc-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((value, index) => {
            if (!value) return <span key={`blank-${index}`} className="h-9" />;
            const disabled = value < today;
            const isStart = value === checkIn;
            const isEnd = value === checkOut;
            const inRange = value > checkIn && value < checkOut;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => chooseDate(value)}
                className={cn(
                  'flex h-9 items-center justify-center rounded-lg text-sm font-bold transition',
                  disabled && 'cursor-not-allowed text-zinc-700',
                  !disabled && 'text-zinc-200 hover:bg-white/10',
                  inRange && 'bg-[#0d8a62]/15 text-[#35d49a]',
                  (isStart || isEnd) && 'bg-[#0d8a62] text-white shadow-sm shadow-[#0d8a62]/25 hover:bg-[#0d8a62]',
                )}
                aria-label={value}
              >
                {Number(value.slice(-2))}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);

  return (
    <div ref={pickerRef} className="relative">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-300">Dates</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => openCalendar('checkin')}
          className={cn(searchInputClass, 'flex h-auto min-h-12 items-center justify-between px-3 py-2 text-left')}
          aria-label="Open hotel date calendar"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">Check in</span>
            <span className="block truncate">{formatTripDate(checkIn)}</span>
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-zinc-400" />
        </button>
        <button
          type="button"
          onClick={() => openCalendar('checkout')}
          className={cn(searchInputClass, 'flex h-auto min-h-12 items-center justify-between px-3 py-2 text-left')}
          aria-label="Open hotel date calendar"
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">Check out</span>
            <span className="block truncate">{formatTripDate(checkOut)}</span>
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-zinc-400" />
        </button>
      </div>
      <p className="mt-1 text-xs font-semibold text-zinc-500">{stayNights} night{stayNights === 1 ? '' : 's'}</p>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-full rounded-xl border border-white/10 bg-[#080a09] p-3 shadow-2xl shadow-black/70 sm:w-[40rem]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-black text-zinc-300 hover:bg-white/10"
            >
              Prev
            </button>
            <div className="text-center text-xs font-bold text-zinc-400">
              {selectingCheckout ? 'Choose check-out' : 'Choose check-in'}
            </div>
            <button
              type="button"
              onClick={() => setVisibleMonth(nextMonth)}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-black text-zinc-300 hover:bg-white/10"
            >
              Next
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {renderMonth(visibleMonth)}
            <div className="hidden sm:block">{renderMonth(nextMonth)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPills({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3;
  options: Array<{ value: string; label: string; count?: number; disabled?: boolean }>;
}) {
  return (
    <div className={cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {options.map(option => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-10 rounded-lg border px-2.5 py-2 text-left text-xs font-black transition',
              active
                ? 'border-[#0d8a62] bg-[#0d8a62] text-white shadow-sm shadow-[#0d8a62]/20'
                : 'border-zinc-700 bg-[#111512] text-zinc-300 hover:border-[#0d8a62] hover:bg-[#16201b] hover:text-white',
              option.disabled && 'cursor-not-allowed opacity-45 hover:border-zinc-700 hover:bg-[#111512] hover:text-zinc-300',
            )}
          >
            <span className="block leading-tight">{option.label}</span>
            {option.count !== undefined && (
              <span className={cn('mt-0.5 block text-[10px]', active ? 'text-white/75' : 'text-zinc-500')}>
                {option.count} match{option.count === 1 ? '' : 'es'}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TrustStrip() {
  return (
    <div className="grid gap-2 border-t border-white/10 bg-black px-4 py-3 sm:grid-cols-4 sm:px-5">
      {[
        { icon: CheckCircle2, text: 'Live provider rates' },
        { icon: CreditCard, text: '$20 fee + applicable tax' },
        { icon: Lock, text: 'Secure checkout' },
        { icon: ShieldCheck, text: 'No commission added' },
      ].map(item => (
        <div key={item.text} className="flex items-center gap-2 text-xs font-bold text-zinc-200">
          <item.icon className="h-4 w-4 text-[#35d49a]" />
          {item.text}
        </div>
      ))}
    </div>
  );
}

function CountControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-300">{label}</span>
      <div className="flex h-12 items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-[#111512] px-1.5">
        <button
          type="button"
          className={stepperButtonClass}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-8 text-center text-sm font-black text-white">{value}</span>
        <button
          type="button"
          className={stepperButtonClass}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ResultShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight text-white">{title}</h2>
          <p className="text-sm text-zinc-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>('flights');

  const [tripType, setTripType] = useState<TripType>('round_trip');
  const [origin, setOrigin] = useState('YVR');
  const [destination, setDestination] = useState('YYZ');
  const [departureDate, setDepartureDate] = useState(dateOffset(21));
  const [returnDate, setReturnDate] = useState(dateOffset(28));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [childAgesText, setChildAgesText] = useState('');
  const [cabinClass, setCabinClass] = useState<(typeof cabinOptions)[number]['value']>('economy');

  const [hotelDestination, setHotelDestination] = useState('Toronto');
  const [checkIn, setCheckIn] = useState(dateOffset(21));
  const [checkOut, setCheckOut] = useState(dateOffset(24));
  const [hotelAdults, setHotelAdults] = useState(1);
  const [hotelChildren, setHotelChildren] = useState(0);
  const [hotelChildAgesText, setHotelChildAgesText] = useState('');

  const [flights, setFlights] = useState<FlightResult[]>([]);
  const [hotels, setHotels] = useState<HotelResult[]>([]);
  const [flightMeta, setFlightMeta] = useState<SearchMeta | null>(null);
  const [hotelMeta, setHotelMeta] = useState<(SearchMeta & { noResultsMessage?: string }) | null>(null);
  const [loading, setLoading] = useState<ActiveTab | null>(null);
  const [error, setError] = useState('');

  const [selectedFlight, setSelectedFlight] = useState<FlightResult | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<HotelResult | null>(null);
  const [detailHotel, setDetailHotel] = useState<HotelResult | null>(null);

  const [flightSort, setFlightSort] = useState<FlightSort>('price');
  const [stopFilter, setStopFilter] = useState<StopFilter>('all');
  const [airlineFilter, setAirlineFilter] = useState('all');
  const [departWindow, setDepartWindow] = useState<DepartWindow>('all');
  const [maxFlightPrice, setMaxFlightPrice] = useState('');
  const [refundableOnly, setRefundableOnly] = useState(false);
  const [baggageOnly, setBaggageOnly] = useState(false);

  const [hotelSort, setHotelSort] = useState<HotelSort>('price');
  const [starFilter, setStarFilter] = useState('all');
  const [maxHotelPrice, setMaxHotelPrice] = useState('');
  const [refundableHotelOnly, setRefundableHotelOnly] = useState(false);
  const [minHotelRating, setMinHotelRating] = useState('all');
  const [minHotelReviews, setMinHotelReviews] = useState('all');
  const [hotelDistance, setHotelDistance] = useState('all');
  const [petFriendlyHotelOnly, setPetFriendlyHotelOnly] = useState(false);
  const [poolHotelOnly, setPoolHotelOnly] = useState(false);
  const [parkingHotelOnly, setParkingHotelOnly] = useState(false);
  const [familyHotelOnly, setFamilyHotelOnly] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SEARCH_SESSION_KEY);
      const saved = raw ? JSON.parse(raw) as SearchSessionSnapshot : null;
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      const requestedTab: ActiveTab | undefined = urlTab === 'hotels' ? 'hotels' : urlTab === 'flights' ? 'flights' : undefined;

      if (saved?.flightForm) {
        setTripType(saved.flightForm.tripType);
        setOrigin(saved.flightForm.origin);
        setDestination(saved.flightForm.destination);
        setDepartureDate(saved.flightForm.departureDate);
        setReturnDate(saved.flightForm.returnDate);
        setAdults(saved.flightForm.adults);
        setChildren(saved.flightForm.children);
        setChildAgesText(saved.flightForm.childAgesText);
        setCabinClass(saved.flightForm.cabinClass);
      }
      if (saved?.hotelForm) {
        setHotelDestination(saved.hotelForm.destination);
        setCheckIn(saved.hotelForm.checkIn);
        setCheckOut(saved.hotelForm.checkOut);
        setHotelAdults(saved.hotelForm.adults);
        setHotelChildren(saved.hotelForm.children);
        setHotelChildAgesText(saved.hotelForm.childAgesText);
      }
      if (saved?.flights) setFlights(saved.flights);
      if (saved?.hotels) setHotels(saved.hotels);
      if (saved?.flightMeta !== undefined) setFlightMeta(normalizeSavedMeta(saved.flightMeta, 'flights') ?? null);
      if (saved?.hotelMeta !== undefined) setHotelMeta(normalizeSavedMeta(saved.hotelMeta, 'hotels') ?? null);
      if (saved?.selectedFlight !== undefined) setSelectedFlight(saved.selectedFlight);
      if (saved?.selectedHotel !== undefined) setSelectedHotel(saved.selectedHotel);
      if (saved?.filters) {
        setFlightSort(saved.filters.flightSort);
        setStopFilter(saved.filters.stopFilter);
        setAirlineFilter(saved.filters.airlineFilter);
        setDepartWindow(saved.filters.departWindow);
        setMaxFlightPrice(saved.filters.maxFlightPrice);
        setRefundableOnly(saved.filters.refundableOnly);
        setBaggageOnly(saved.filters.baggageOnly);
        setHotelSort(saved.filters.hotelSort);
        setStarFilter(saved.filters.starFilter);
        setMaxHotelPrice(saved.filters.maxHotelPrice);
        setRefundableHotelOnly(saved.filters.refundableHotelOnly);
        setMinHotelRating(saved.filters.minHotelRating);
        setMinHotelReviews(saved.filters.minHotelReviews);
        setHotelDistance(saved.filters.hotelDistance);
        setPetFriendlyHotelOnly(saved.filters.petFriendlyHotelOnly);
        setPoolHotelOnly(saved.filters.poolHotelOnly);
        setParkingHotelOnly(saved.filters.parkingHotelOnly);
        setFamilyHotelOnly(saved.filters.familyHotelOnly);
      }

      setActiveTab(requestedTab ?? saved?.activeTab ?? 'flights');
    } catch {
      // Session restore is a convenience only; fresh search still works.
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const snapshot: SearchSessionSnapshot = {
      activeTab,
      flightForm: {
        tripType,
        origin,
        destination,
        departureDate,
        returnDate,
        adults,
        children,
        childAgesText,
        cabinClass,
      },
      hotelForm: {
        destination: hotelDestination,
        checkIn,
        checkOut,
        adults: hotelAdults,
        children: hotelChildren,
        childAgesText: hotelChildAgesText,
      },
      flights,
      hotels,
      flightMeta,
      hotelMeta,
      selectedFlight,
      selectedHotel,
      filters: {
        flightSort,
        stopFilter,
        airlineFilter,
        departWindow,
        maxFlightPrice,
        refundableOnly,
        baggageOnly,
        hotelSort,
        starFilter,
        maxHotelPrice,
        refundableHotelOnly,
        minHotelRating,
        minHotelReviews,
        hotelDistance,
        petFriendlyHotelOnly,
        poolHotelOnly,
        parkingHotelOnly,
        familyHotelOnly,
      },
    };
    try {
      window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore quota/private-mode failures; the booking funnel still functions.
    }
  }, [
    activeTab,
    adults,
    airlineFilter,
    baggageOnly,
    cabinClass,
    checkIn,
    checkOut,
    childAgesText,
    children,
    departWindow,
    departureDate,
    destination,
    familyHotelOnly,
    flightMeta,
    flightSort,
    flights,
    hotelAdults,
    hotelChildAgesText,
    hotelChildren,
    hotelDestination,
    hotelDistance,
    hotelMeta,
    hotelSort,
    hotels,
    maxFlightPrice,
    maxHotelPrice,
    minHotelRating,
    minHotelReviews,
    origin,
    parkingHotelOnly,
    petFriendlyHotelOnly,
    poolHotelOnly,
    refundableHotelOnly,
    refundableOnly,
    returnDate,
    selectedFlight,
    selectedHotel,
    sessionReady,
    starFilter,
    stopFilter,
    tripType,
  ]);

  const childAges = useMemo(() => parseTravelerAges(childAgesText).slice(0, children), [childAgesText, children]);
  const hotelChildAges = useMemo(() => parseTravelerAges(hotelChildAgesText).slice(0, hotelChildren), [hotelChildAgesText, hotelChildren]);
  const childAgeFields = useMemo(() => ageFieldValues(childAgesText, children), [childAgesText, children]);
  const hotelChildAgeFields = useMemo(() => ageFieldValues(hotelChildAgesText, hotelChildren), [hotelChildAgesText, hotelChildren]);

  const airlines = useMemo(() => Array.from(new Set(flights.map(f => f.airline).filter(Boolean))).sort(), [flights]);
  const hotelFacetCounts = useMemo(() => {
    const knownAmenityHotels = hotels.filter(canEvaluateAmenities).length;
    const distanceReadyHotels = hotels.filter(h => Number.isFinite(distanceKm(h))).length;
    const pet = hotels.filter(h => amenityMatches(h, ['pet', 'pets allowed', 'dog', 'cat'])).length;
    const pool = hotels.filter(h => amenityMatches(h, ['pool', 'swimming'])).length;
    const parking = hotels.filter(h => amenityMatches(h, ['parking', 'garage', 'valet'])).length;
    const family = hotels.filter(h => amenityMatches(h, ['family', 'children', 'kids', 'baby', 'sofa bed'])).length;
    return {
      stars3: hotels.filter(h => h.stars >= 3).length,
      stars4: hotels.filter(h => h.stars >= 4).length,
      stars5: hotels.filter(h => h.stars >= 5).length,
      rating8: hotels.filter(h => (h.rating ?? 0) >= 8).length,
      rating85: hotels.filter(h => (h.rating ?? 0) >= 8.5).length,
      rating9: hotels.filter(h => (h.rating ?? 0) >= 9).length,
      reviews50: hotels.filter(h => (h.reviewCount ?? 0) >= 50).length,
      reviews200: hotels.filter(h => (h.reviewCount ?? 0) >= 200).length,
      reviews500: hotels.filter(h => (h.reviewCount ?? 0) >= 500).length,
      distance1: hotels.filter(h => distanceKm(h) <= 1).length,
      distance3: hotels.filter(h => distanceKm(h) <= 3).length,
      distance5: hotels.filter(h => distanceKm(h) <= 5).length,
      refundable: hotels.filter(h => h.cancellation === 'Free cancellation' || h.refundableTag === 'RFN').length,
      pet,
      pool,
      parking,
      family,
      amenityDataReady: knownAmenityHotels > 0,
      starsReady: hotels.some(h => h.stars > 0),
      ratingReady: hotels.some(h => (h.rating ?? 0) > 0),
      reviewsReady: hotels.some(h => (h.reviewCount ?? 0) > 0),
      distanceReady: distanceReadyHotels > 0,
    };
  }, [hotels]);
  const hotelSortOptions = useMemo(() => [
    { value: 'price', label: 'Lowest' },
    ...(hotelFacetCounts.ratingReady ? [{ value: 'rating', label: 'Rating' }] : []),
    ...(hotelFacetCounts.starsReady ? [{ value: 'stars', label: 'Stars' }] : []),
    ...(hotelFacetCounts.reviewsReady ? [{ value: 'reviews', label: 'Reviews' }] : []),
    ...(hotelFacetCounts.distanceReady ? [{ value: 'distance', label: 'Near center' }] : []),
  ], [hotelFacetCounts.distanceReady, hotelFacetCounts.ratingReady, hotelFacetCounts.reviewsReady, hotelFacetCounts.starsReady]);

  useEffect(() => {
    if (!hotelFacetCounts.starsReady && starFilter !== 'all') setStarFilter('all');
    if (!hotelFacetCounts.ratingReady && minHotelRating !== 'all') setMinHotelRating('all');
    if (!hotelFacetCounts.reviewsReady && minHotelReviews !== 'all') setMinHotelReviews('all');
    if (!hotelFacetCounts.distanceReady && hotelDistance !== 'all') setHotelDistance('all');
    if (hotelFacetCounts.refundable === 0 && refundableHotelOnly) setRefundableHotelOnly(false);
    if (hotelFacetCounts.pet === 0 && petFriendlyHotelOnly) setPetFriendlyHotelOnly(false);
    if (hotelFacetCounts.pool === 0 && poolHotelOnly) setPoolHotelOnly(false);
    if (hotelFacetCounts.parking === 0 && parkingHotelOnly) setParkingHotelOnly(false);
    if (hotelFacetCounts.family === 0 && familyHotelOnly) setFamilyHotelOnly(false);
    if (!hotelSortOptions.some(option => option.value === hotelSort)) setHotelSort('price');
  }, [
    familyHotelOnly,
    hotelDistance,
    hotelFacetCounts.distanceReady,
    hotelFacetCounts.family,
    hotelFacetCounts.parking,
    hotelFacetCounts.pet,
    hotelFacetCounts.pool,
    hotelFacetCounts.ratingReady,
    hotelFacetCounts.reviewsReady,
    hotelFacetCounts.refundable,
    hotelFacetCounts.starsReady,
    hotelSort,
    hotelSortOptions,
    minHotelRating,
    minHotelReviews,
    parkingHotelOnly,
    petFriendlyHotelOnly,
    poolHotelOnly,
    refundableHotelOnly,
    starFilter,
  ]);

  const filteredFlights = useMemo(() => {
    const maxPrice = maxFlightPrice ? Number(maxFlightPrice) : Infinity;
    return [...flights]
      .filter(f => {
        const stops = maxStops(f);
        if (stopFilter === '0' && stops !== 0) return false;
        if (stopFilter === '1' && stops !== 1) return false;
        if (stopFilter === '2+' && stops < 2) return false;
        if (airlineFilter !== 'all' && f.airline !== airlineFilter) return false;
        if (!departWindowMatches(f, departWindow)) return false;
        if (Number.isFinite(maxPrice) && f.price > maxPrice) return false;
        if (refundableOnly && !f.refundable && !f.fareVariants?.some(v => v.refundable)) return false;
        if (baggageOnly && !f.baggage && !f.fareVariants?.some(v => (v.checkedBags ?? 0) > 0)) return false;
        return true;
      })
      .sort((a, b) => {
        if (flightSort === 'price') return a.price - b.price;
        if (flightSort === 'duration') return (durationMinutes(a.duration) + durationMinutes(a.returnDuration)) - (durationMinutes(b.duration) + durationMinutes(b.returnDuration));
        if (flightSort === 'stops') return maxStops(a) - maxStops(b);
        return new Date(a.departure).getTime() - new Date(b.departure).getTime();
      });
  }, [airlineFilter, baggageOnly, departWindow, flightSort, flights, maxFlightPrice, refundableOnly, stopFilter]);

  const filteredHotels = useMemo(() => {
    const maxPrice = maxHotelPrice ? Number(maxHotelPrice) : Infinity;
    return [...hotels]
      .filter(h => {
        if (starFilter !== 'all' && h.stars < Number(starFilter)) return false;
        if (minHotelRating !== 'all' && (h.rating ?? 0) < Number(minHotelRating)) return false;
        if (minHotelReviews !== 'all' && (h.reviewCount ?? 0) < Number(minHotelReviews)) return false;
        if (hotelDistance !== 'all' && distanceKm(h) > Number(hotelDistance)) return false;
        if (Number.isFinite(maxPrice) && h.pricePerNight > maxPrice) return false;
        if (refundableHotelOnly && h.cancellation !== 'Free cancellation' && h.refundableTag !== 'RFN') return false;
        if (petFriendlyHotelOnly && hotelFacetCounts.amenityDataReady && !amenityMatches(h, ['pet', 'pets allowed', 'dog', 'cat'])) return false;
        if (poolHotelOnly && hotelFacetCounts.amenityDataReady && !amenityMatches(h, ['pool', 'swimming'])) return false;
        if (parkingHotelOnly && hotelFacetCounts.amenityDataReady && !amenityMatches(h, ['parking', 'garage', 'valet'])) return false;
        if (familyHotelOnly && hotelFacetCounts.amenityDataReady && !amenityMatches(h, ['family', 'children', 'kids', 'baby', 'sofa bed'])) return false;
        return true;
      })
      .sort((a, b) => {
        if (hotelSort === 'rating') return b.rating - a.rating;
        if (hotelSort === 'stars') return b.stars - a.stars;
        if (hotelSort === 'reviews') return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
        if (hotelSort === 'distance') return distanceKm(a) - distanceKm(b);
        return a.pricePerNight - b.pricePerNight;
      });
  }, [familyHotelOnly, hotelDistance, hotelFacetCounts.amenityDataReady, hotelSort, hotels, maxHotelPrice, minHotelRating, minHotelReviews, parkingHotelOnly, petFriendlyHotelOnly, poolHotelOnly, refundableHotelOnly, starFilter]);

  async function searchFlights() {
    changeTab('flights');
    setLoading('flights');
    setError('');
    setSelectedFlight(null);
    if (children > 0 && childAges.length !== children) {
      setLoading(null);
      setError('Please enter an age for each child so airlines can return the right fare.');
      return;
    }
    try {
      const sessionId = getWebSessionId();
      const res = await fetch('/api/search/flights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          origin,
          destination,
          departureDate,
          returnDate: tripType === 'round_trip' ? returnDate : undefined,
          tripType,
          adults,
          childrenAges: childAges,
          cabinClass,
        }),
      });
      const data = await res.json() as FlightSearchResponse;
      if (!res.ok) throw new Error(data.error ?? 'Flight search failed');
      setFlights(data.flights ?? []);
      setFlightMeta({
        sources: data.sources ?? [],
        latencyMs: data.latencyMs ?? 0,
        publicMessages: data.publicMessages ?? [],
        issueCount: data.issueCount,
        errors: [],
      });
      setTimeout(() => document.getElementById('flight-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setFlights([]);
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(null);
    }
  }

  async function searchHotels() {
    changeTab('hotels');
    setLoading('hotels');
    setError('');
    setSelectedHotel(null);
    if (hotelChildren > 0 && hotelChildAges.length !== hotelChildren) {
      setLoading(null);
      setError('Please enter an age for each child so hotels can return the right room rate.');
      return;
    }
    try {
      const sessionId = getWebSessionId();
      const res = await fetch('/api/search/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          destination: hotelDestination,
          checkIn,
          checkOut,
          adults: hotelAdults,
          childrenAges: hotelChildAges,
          maxPrice: maxHotelPrice ? Number(maxHotelPrice) : undefined,
          stars: starFilter !== 'all' ? Number(starFilter) : undefined,
        }),
      });
      const data = await res.json() as HotelSearchResponse;
      if (!res.ok) throw new Error(data.error ?? 'Hotel search failed');
      setHotels(data.hotels ?? []);
      setHotelMeta({
        sources: data.sources ?? [],
        latencyMs: data.latencyMs ?? 0,
        publicMessages: data.publicMessages ?? [],
        issueCount: data.issueCount,
        errors: [],
        noResultsMessage: data.noResultsMessage,
      });
      setTimeout(() => document.getElementById('hotel-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setHotels([]);
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(null);
    }
  }

  function persistAndCheckout() {
    const sessionId = getWebSessionId();
    const ages = selectedFlight ? (selectedFlight.childrenAges ?? childAges) : hotelChildAges;
    const cartData = createBookingCart({
      flight: selectedFlight,
      hotel: selectedHotel,
      adults: selectedFlight ? adults : hotelAdults,
      childAges: ages,
      sessionId,
    });
    sessionStorage.setItem('ft_cart', JSON.stringify(cartData));
    router.push('/booking');
  }

  const hasSelection = !!selectedFlight || !!selectedHotel;
  const changeTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/?tab=${tab}#search`);
    }
  };

  return (
    <main className="booking-brand-dark min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <TopNav activeTab={activeTab} onTabChange={changeTab} />

      <section className="relative overflow-hidden border-b border-white/10 bg-black" id="search">
        <div
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1800&h=900&fit=crop&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/82 via-black/88 to-[#050505]" aria-hidden />
        <div className="relative mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8 lg:py-10">
          <div className="max-w-6xl pb-5">
            <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl xl:whitespace-nowrap">
              Real rates. One flat fee. No commission games.
            </h1>
            <p className="mt-2 max-w-5xl text-sm font-medium leading-6 text-zinc-300 lg:whitespace-nowrap lg:text-base">
              Search live provider inventory, compare the real options, and pay FlexeTravels one transparent $20 booking fee with no commission added.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#080a09] shadow-2xl shadow-black/40">
            <div className="flex border-b border-white/10 bg-black px-3 pt-3">
              {[
                { id: 'flights' as const, label: 'Flights', icon: Plane },
                { id: 'hotels' as const, label: 'Hotels', icon: Hotel },
              ].map(tab => (
                <button
                  key={tab.id}
                  id={tab.id}
                  type="button"
                  onClick={() => changeTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-t-lg px-4 py-3 text-sm font-black transition',
                    activeTab === tab.id
                      ? 'bg-[#0d8a62] text-white'
                      : 'text-zinc-300 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'flights' ? (
              <div className="bg-[#0b0d0c] p-4 sm:p-5">
                <div className="mb-4 flex w-fit rounded-xl bg-black p-1 ring-1 ring-white/10">
                  {[
                    ['round_trip', 'Round trip'],
                    ['one_way', 'One way'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTripType(value as TripType)}
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm font-bold transition',
                        tripType === value ? 'bg-[#0d8a62] text-white shadow-sm shadow-[#0d8a62]/20' : 'text-zinc-400 hover:text-white',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-12">
                  <Field label="From" className="lg:col-span-2" tone="dark">
                    <input className={searchInputClass} value={origin} onChange={e => setOrigin(e.target.value)} placeholder="YVR or Vancouver" />
                  </Field>
                  <Field label="To" className="lg:col-span-2" tone="dark">
                    <input className={searchInputClass} value={destination} onChange={e => setDestination(e.target.value)} placeholder="YYZ or Toronto" />
                  </Field>
                  <Field label="Depart" className="lg:col-span-2" tone="dark">
                    <DateInput value={departureDate} onChange={setDepartureDate} ariaLabel="Departure date" />
                  </Field>
                  {tripType === 'round_trip' && (
                    <Field label="Return" className="lg:col-span-2" tone="dark">
                      <DateInput value={returnDate} onChange={setReturnDate} min={departureDate} ariaLabel="Return date" />
                    </Field>
                  )}
                  <div className={cn(tripType === 'round_trip' ? 'lg:col-span-2' : 'lg:col-span-3')}>
                    <CountControl label="Adults" value={adults} min={1} max={9} onChange={setAdults} />
                  </div>
                  <div className={cn(tripType === 'round_trip' ? 'lg:col-span-2' : 'lg:col-span-3')}>
                    <CountControl
                      label="Children"
                      value={children}
                      min={0}
                      max={8}
                      onChange={next => {
                        setChildren(next);
                        setChildAgesText(ageFieldValues(childAgesText, next).join(', '));
                      }}
                    />
                  </div>
                  <Field label="Cabin" className={cn(tripType === 'round_trip' ? 'lg:col-span-2' : 'lg:col-span-2')} tone="dark">
                    <select className={searchInputClass} value={cabinClass} onChange={e => setCabinClass(e.target.value as typeof cabinClass)}>
                      {cabinOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <div className={cn('flex items-end', tripType === 'round_trip' ? 'lg:col-span-2' : 'lg:col-span-2')}>
                    <button
                      type="button"
                      onClick={() => void searchFlights()}
                      disabled={loading === 'flights'}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#0d8a62] px-4 text-sm font-black text-white shadow-sm shadow-[#0d8a62]/20 transition hover:bg-[#0a6e50] disabled:cursor-wait disabled:bg-[#0d8a62]/60"
                    >
                      {loading === 'flights' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {loading === 'flights' ? 'Checking live fares' : 'Search'}
                    </button>
                  </div>
                </div>
                {loading === 'flights' && (
                  <p className="mt-3 text-xs font-semibold text-zinc-400">
                    Duffel is checking live airline inventory. Some international searches can take up to 30 seconds.
                  </p>
                )}
                {children > 0 && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-200">Children ages</p>
                    <p className="mt-1 text-xs text-zinc-400">Ages are required so Duffel can price child seats, teen fares, and lap infants correctly.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {childAgeFields.map((age, index) => (
                        <Field key={index} label={`Child ${index + 1}`} tone="dark">
                          <input
                            className={searchInputClass}
                            type="number"
                            min={0}
                            max={17}
                            value={age}
                            onChange={e => setChildAgesText(updateAgeField(childAgesText, children, index, e.target.value))}
                            placeholder="Age"
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#0b0d0c] p-4 sm:p-5">
                <div className="grid gap-3 lg:grid-cols-12">
                  <Field label="Destination" className="lg:col-span-3" tone="dark">
                    <input className={searchInputClass} value={hotelDestination} onChange={e => setHotelDestination(e.target.value)} placeholder="City or region" />
                  </Field>
                  <div className="lg:col-span-4">
                    <HotelDateRangePicker
                      checkIn={checkIn}
                      checkOut={checkOut}
                      onCheckInChange={setCheckIn}
                      onCheckOutChange={setCheckOut}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <CountControl label="Adults" value={hotelAdults} min={1} max={9} onChange={setHotelAdults} />
                  </div>
                  <div className="lg:col-span-1">
                    <CountControl
                      label="Children"
                      value={hotelChildren}
                      min={0}
                      max={8}
                      onChange={next => {
                        setHotelChildren(next);
                        setHotelChildAgesText(ageFieldValues(hotelChildAgesText, next).join(', '));
                      }}
                    />
                  </div>
                  <div className="flex items-end lg:col-span-2">
                    <button
                      type="button"
                      onClick={() => void searchHotels()}
                      disabled={loading === 'hotels'}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#0d8a62] px-4 text-sm font-black text-white shadow-sm shadow-[#0d8a62]/20 transition hover:bg-[#0a6e50] disabled:cursor-wait disabled:bg-[#0d8a62]/60"
                    >
                      {loading === 'hotels' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      Search hotels
                    </button>
                  </div>
                </div>
                {hotelChildren > 0 && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-200">Children ages</p>
                    <p className="mt-1 text-xs text-zinc-400">Ages are required so LiteAPI can return room rates that match your party.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {hotelChildAgeFields.map((age, index) => (
                        <Field key={index} label={`Child ${index + 1}`} tone="dark">
                          <input
                            className={searchInputClass}
                            type="number"
                            min={0}
                            max={17}
                            value={age}
                            onChange={e => setHotelChildAgesText(updateAgeField(hotelChildAgesText, hotelChildren, index, e.target.value))}
                            placeholder="Age"
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <TrustStrip />
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm font-semibold text-red-200">
              {error}
            </div>
          )}
        </div>
      </section>

      <section className="border-b border-white/10 bg-black">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-4 sm:grid-cols-3 sm:px-6 lg:px-8">
          {[
            ['No commission added', 'We charge one flat booking fee instead of hiding margin inside the fare.'],
            ['Transparent totals', 'Provider fare plus the flat booking fee before you pay.'],
            ['Live fare lock check', 'Your selected offer is re-verified before payment setup.'],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#35d49a]" />
              <div className="min-w-0">
                <p className="text-sm font-black text-white">{title}</p>
                <p className="text-xs leading-5 text-zinc-400 xl:whitespace-nowrap">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {activeTab === 'flights' && (flights.length > 0 || flightMeta) && (
        <ResultShell
          title="Choose your flight"
          subtitle={`${filteredFlights.length} of ${flights.length} options shown${flightMeta?.sources.length ? ` · ${flightMeta.sources.join(', ')}` : ''}${flightMeta?.latencyMs ? ` · ${Math.round(flightMeta.latencyMs / 100) / 10}s` : ''}`}
        >
          <div id="flight-results" className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <aside className="h-fit rounded-xl border border-white/10 bg-[#0b0d0c] p-4 shadow-sm shadow-black/30">
              <div className="mb-4 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[#35d49a]" />
                <h3 className="text-sm font-black text-white">Filter flights</h3>
              </div>
              <div className="space-y-4">
                <Field label="Sort by">
                  <select className={inputClass} value={flightSort} onChange={e => setFlightSort(e.target.value as FlightSort)}>
                    <option value="price">Lowest price</option>
                    <option value="duration">Shortest total duration</option>
                    <option value="departure">Earliest departure</option>
                    <option value="stops">Fewest stops</option>
                  </select>
                </Field>
                <Field label="Stops">
                  <select className={inputClass} value={stopFilter} onChange={e => setStopFilter(e.target.value as StopFilter)}>
                    <option value="all">All stops</option>
                    <option value="0">Non-stop only</option>
                    <option value="1">1 stop</option>
                    <option value="2+">2+ stops</option>
                  </select>
                </Field>
                <Field label="Airline">
                  <select className={inputClass} value={airlineFilter} onChange={e => setAirlineFilter(e.target.value)}>
                    <option value="all">All airlines</option>
                    {airlines.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Departure">
                  <select className={inputClass} value={departWindow} onChange={e => setDepartWindow(e.target.value as DepartWindow)}>
                    <option value="all">Any time</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening / overnight</option>
                  </select>
                </Field>
                <Field label="Max total price">
                  <input className={inputClass} type="number" min={0} value={maxFlightPrice} onChange={e => setMaxFlightPrice(e.target.value)} placeholder="No limit" />
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <input type="checkbox" className="h-4 w-4 accent-[#0d8a62]" checked={refundableOnly} onChange={e => setRefundableOnly(e.target.checked)} />
                  Refundable/change-friendly
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                  <input type="checkbox" className="h-4 w-4 accent-[#0d8a62]" checked={baggageOnly} onChange={e => setBaggageOnly(e.target.checked)} />
                  Checked baggage available
                </label>
              </div>
            </aside>

            <div className="space-y-4">
              {flightMeta?.publicMessages.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {flightMeta.publicMessages.join(' · ')}
                </div>
              ) : null}
              {filteredFlights.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#0b0d0c] p-8 text-center">
                  <Filter className="mx-auto mb-3 h-6 w-6 text-zinc-500" />
                  <p className="font-black text-white">No flights match these filters.</p>
                  <p className="text-sm text-zinc-400">Try widening stops, airline, or price.</p>
                </div>
              ) : filteredFlights.map(flight => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  selected={selectedFlight?.id === flight.id || selectedFlight?.bookingToken === flight.id}
                  isBestValue={flight.id === filteredFlights[0]?.id}
                  onSelect={f => setSelectedFlight(f)}
                />
              ))}
            </div>
          </div>
        </ResultShell>
      )}

      {activeTab === 'hotels' && (hotels.length > 0 || hotelMeta) && (
        <ResultShell
          title="Choose your hotel"
          subtitle={`${filteredHotels.length} of ${hotels.length} options shown${hotelMeta?.sources.length ? ` · ${hotelMeta.sources.join(', ')}` : ''}${hotelMeta?.latencyMs ? ` · ${Math.round(hotelMeta.latencyMs / 100) / 10}s` : ''}`}
        >
          <div id="hotel-results" className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <aside className="h-fit rounded-xl border border-white/10 bg-[#0b0d0c] p-4 shadow-sm shadow-black/30">
              <div className="mb-4 flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[#35d49a]" />
                <h3 className="text-sm font-black text-white">Filter hotels</h3>
              </div>
              <div className="space-y-4">
                <Field label="Sort by">
                  <FilterPills
                    value={hotelSort}
                    onChange={value => setHotelSort(value as HotelSort)}
                    options={hotelSortOptions}
                  />
                </Field>
                {hotelFacetCounts.starsReady && (
                  <Field label="Stars">
                    <FilterPills
                      value={starFilter}
                      onChange={setStarFilter}
                      options={[
                        { value: 'all', label: 'All', count: hotels.length },
                        ...[
                          { value: '3', label: '3★+', count: hotelFacetCounts.stars3 },
                          { value: '4', label: '4★+', count: hotelFacetCounts.stars4 },
                          { value: '5', label: '5★', count: hotelFacetCounts.stars5 },
                        ].filter(option => option.count > 0),
                      ]}
                    />
                  </Field>
                )}
                {hotelFacetCounts.ratingReady && (
                  <Field label="Guest rating">
                    <FilterPills
                      value={minHotelRating}
                      onChange={setMinHotelRating}
                      options={[
                        { value: 'all', label: 'Any', count: hotels.length },
                        ...[
                          { value: '8', label: '8.0+', count: hotelFacetCounts.rating8 },
                          { value: '8.5', label: '8.5+', count: hotelFacetCounts.rating85 },
                          { value: '9', label: '9.0+', count: hotelFacetCounts.rating9 },
                        ].filter(option => option.count > 0),
                      ]}
                    />
                  </Field>
                )}
                {hotelFacetCounts.reviewsReady && (
                  <Field label="Review depth">
                    <FilterPills
                      value={minHotelReviews}
                      onChange={setMinHotelReviews}
                      options={[
                        { value: 'all', label: 'Any', count: hotels.length },
                        ...[
                          { value: '50', label: '50+', count: hotelFacetCounts.reviews50 },
                          { value: '200', label: '200+', count: hotelFacetCounts.reviews200 },
                          { value: '500', label: '500+', count: hotelFacetCounts.reviews500 },
                        ].filter(option => option.count > 0),
                      ]}
                    />
                  </Field>
                )}
                {hotelFacetCounts.distanceReady && (
                  <Field label="Location">
                    <FilterPills
                      value={hotelDistance}
                      onChange={setHotelDistance}
                      options={[
                        { value: 'all', label: 'Any', count: hotels.length },
                        ...[
                          { value: '1', label: '1 km', count: hotelFacetCounts.distance1 },
                          { value: '3', label: '3 km', count: hotelFacetCounts.distance3 },
                          { value: '5', label: '5 km', count: hotelFacetCounts.distance5 },
                        ].filter(option => option.count > 0),
                      ]}
                    />
                  </Field>
                )}
                <Field label="Max price/night">
                  <input className={inputClass} type="number" min={0} value={maxHotelPrice} onChange={e => setMaxHotelPrice(e.target.value)} placeholder="No limit" />
                </Field>
                {[
                  {
                    label: 'Free cancellation',
                    count: hotelFacetCounts.refundable,
                    active: refundableHotelOnly,
                    onClick: () => setRefundableHotelOnly(!refundableHotelOnly),
                  },
                  {
                    label: 'Pet friendly',
                    count: hotelFacetCounts.pet,
                    active: petFriendlyHotelOnly,
                    onClick: () => setPetFriendlyHotelOnly(!petFriendlyHotelOnly),
                  },
                  {
                    label: 'Pool or swim area',
                    count: hotelFacetCounts.pool,
                    active: poolHotelOnly,
                    onClick: () => setPoolHotelOnly(!poolHotelOnly),
                  },
                  {
                    label: 'Parking available',
                    count: hotelFacetCounts.parking,
                    active: parkingHotelOnly,
                    onClick: () => setParkingHotelOnly(!parkingHotelOnly),
                  },
                  {
                    label: 'Family-friendly rooms',
                    count: hotelFacetCounts.family,
                    active: familyHotelOnly,
                    onClick: () => setFamilyHotelOnly(!familyHotelOnly),
                  },
                ].some(option => option.count > 0 || option.active) && (
                  <Field label="Amenities">
                    <div className="grid gap-2">
                      {[
                        {
                          label: 'Free cancellation',
                          count: hotelFacetCounts.refundable,
                          active: refundableHotelOnly,
                          onClick: () => setRefundableHotelOnly(!refundableHotelOnly),
                        },
                        {
                          label: 'Pet friendly',
                          count: hotelFacetCounts.pet,
                          active: petFriendlyHotelOnly,
                          onClick: () => setPetFriendlyHotelOnly(!petFriendlyHotelOnly),
                        },
                        {
                          label: 'Pool or swim area',
                          count: hotelFacetCounts.pool,
                          active: poolHotelOnly,
                          onClick: () => setPoolHotelOnly(!poolHotelOnly),
                        },
                        {
                          label: 'Parking available',
                          count: hotelFacetCounts.parking,
                          active: parkingHotelOnly,
                          onClick: () => setParkingHotelOnly(!parkingHotelOnly),
                        },
                        {
                          label: 'Family-friendly rooms',
                          count: hotelFacetCounts.family,
                          active: familyHotelOnly,
                          onClick: () => setFamilyHotelOnly(!familyHotelOnly),
                        },
                      ].filter(option => option.count > 0 || option.active).map(option => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={option.onClick}
                        className={cn(
                          'flex min-h-10 items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-black transition',
                          option.active
                            ? 'border-[#0d8a62] bg-[#0d8a62] text-white shadow-sm shadow-[#0d8a62]/20'
                            : 'border-zinc-700 bg-[#111512] text-zinc-300 hover:border-[#0d8a62] hover:bg-[#16201b] hover:text-white',
                        )}
                      >
                        <span>{option.label}</span>
                        <span className={cn('text-[10px]', option.active ? 'text-white/75' : 'text-zinc-500')}>
                          {option.count}
                        </span>
                      </button>
                    ))}
                    </div>
                  </Field>
                )}
              </div>
            </aside>

            <div className="space-y-4">
              {hotelMeta?.noResultsMessage && hotels.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {hotelMeta.noResultsMessage}
                </div>
              ) : null}
              {hotelMeta?.publicMessages.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {hotelMeta.publicMessages.join(' · ')}
                </div>
              ) : null}
              {filteredHotels.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#0b0d0c] p-8 text-center">
                  <Building2 className="mx-auto mb-3 h-6 w-6 text-zinc-500" />
                  <p className="font-black text-white">No hotels match these filters.</p>
                  <p className="text-sm text-zinc-400">Try widening stars, cancellation, or price.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredHotels.map(hotel => (
                    <HotelCard
                      key={hotel.id}
                      hotel={hotel}
                      selected={selectedHotel?.id === hotel.id}
                      isBestDeal={hotel.id === filteredHotels[0]?.id}
                      onSelect={h => setSelectedHotel(h)}
                      onOpenDetail={h => setDetailHotel(h)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </ResultShell>
      )}

      {hasSelection && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#0d8a62]/15 text-[#35d49a]">
                {selectedFlight ? <Plane className="h-4 w-4" /> : <Hotel className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">
                  {selectedFlight
                    ? `${selectedFlight.airline} · ${selectedFlight.origin} to ${selectedFlight.destination}`
                    : selectedHotel?.name}
                </p>
                <p className="text-xs font-medium text-zinc-400">
                  {selectedFlight && `${formatPrice(selectedFlight.price, selectedFlight.currency)} fare + $20 fee + tax where applicable`}
                  {selectedHotel && !selectedFlight && `${formatPrice(selectedHotel.totalPrice, selectedHotel.currency)} hotel total + $20 fee + tax where applicable`}
                  {selectedHotel && selectedFlight && ` · Hotel selected: ${selectedHotel.name}`}
                </p>
                {selectedFlight && (
                  <p className="mt-0.5 max-w-xl truncate text-xs font-semibold text-zinc-400">
                    Fare will be re-verified before payment.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setSelectedFlight(null); setSelectedHotel(null); }}
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm font-bold text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
                Clear
              </button>
              <button
                type="button"
                onClick={persistAndCheckout}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0d8a62] px-5 text-sm font-black text-white hover:bg-[#0a6e50]"
              >
                Continue to checkout
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className={cn('border-t border-white/10 bg-black px-4 py-8 text-center text-xs text-zinc-400', hasSelection && 'pb-28')}>
        <p>FlexeTravels is a technology platform. Flights are booked through Duffel-backed channels. Hotels are searched through LiteAPI.</p>
        <p className="mt-1">Prices are live and can change until verified at payment setup. We do not add commission or hidden markups; FlexeTravels charges one flat $20 booking fee plus applicable tax on that fee.</p>
      </footer>

      {detailHotel && (
        <HotelDetailModal
          hotel={detailHotel}
          onClose={() => setDetailHotel(null)}
          onSelect={hotel => {
            setSelectedHotel(hotel);
            setDetailHotel(null);
          }}
        />
      )}
    </main>
  );
}
