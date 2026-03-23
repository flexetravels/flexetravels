'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plane, Building2, CheckCircle2, Copy, Check, Bot,
  ChevronDown, ChevronLeft, ChevronRight, Compass, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { cn, parseEmbeddedCards, stripCardTags } from '@/lib/utils';
import { FlightCard } from './FlightCard';
import { HotelCard } from './HotelCard';
import { ExperienceCard } from './ExperienceCard';
import { StripePaymentForm } from './StripePaymentForm';
import type { FlightResult, HotelResult, ExperienceResult, BookingConfirmation, PaymentRequiredData } from '@/lib/types';

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
      title="Copy message"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-teal-500" />
        : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      }
    </button>
  );
}

// ─── Typing indicator (3-dot bounce) ─────────────────────────────────────────
export function TypingIndicator() {
  return (
    <div className="msg-row-bot">
      <div className="bot-avatar">
        <Bot className="w-4 h-4" />
      </div>
      <div className="bubble-bot">
        <div className="typing-dots">
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}

// ─── Composing indicator — shown while AI is streaming ───────────────────────
// Replaces the partial-rendered content during streaming to avoid flicker/
// card pop-in from incremental JSON parsing. Shows live tool-status pills
// (so user sees "Searching flights…" feedback) plus a stable composing state.
function ComposingBlock({
  toolCalls,
}: {
  toolCalls: Array<{ toolName: string; state: 'call' | 'result' }>;
}) {
  const toolsActive  = toolCalls.some(tc => tc.state === 'call');
  const toolsDone    = toolCalls.length > 0 && !toolsActive;

  return (
    <div className="bubble-bot">
      <div className="flex items-center gap-2.5 py-0.5">
        {/* Animated dots */}
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-teal-500 dark:bg-teal-400 animate-bounce"
              style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }}
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {toolsActive
            ? 'Searching across providers…'
            : toolsDone
              ? 'Composing your results…'
              : 'Thinking…'}
        </span>
      </div>
    </div>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SkeletonFlightCard() {
  return (
    <div className="travel-card p-4 flex items-center gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-3 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/3" />
      </div>
      <div className="flex-shrink-0 space-y-1.5 text-right">
        <div className="h-5 bg-muted rounded w-16 ml-auto" />
        <div className="h-3 bg-muted rounded w-12 ml-auto" />
        <div className="h-7 bg-muted rounded w-16 ml-auto mt-2" />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SkeletonHotelCard() {
  return (
    <div className="travel-card overflow-hidden animate-pulse">
      <div className="h-36 w-full bg-muted" />
      <div className="p-3 flex gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="h-3 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-2/3" />
          <div className="flex gap-1 mt-2">
            {[1,2,3].map(i => <div key={i} className="h-5 w-12 bg-muted rounded-full" />)}
          </div>
        </div>
        <div className="flex-shrink-0 space-y-1.5 text-right">
          <div className="h-6 bg-muted rounded w-16 ml-auto" />
          <div className="h-3 bg-muted rounded w-10 ml-auto" />
          <div className="h-7 bg-muted rounded w-16 ml-auto mt-2" />
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SkeletonExperienceCard() {
  return (
    <div className="travel-card overflow-hidden animate-pulse">
      <div className="h-36 w-full bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="h-3 bg-muted rounded w-2/3" />
        <div className="h-3 bg-muted rounded w-3/4" />
      </div>
    </div>
  );
}

// ─── Flight results panel with filter + sort ──────────────────────────────────
type FlightSort = 'price' | 'duration' | 'stops';
type StopFilter = 'all' | '0' | '1' | '2+';

function FlightResultsPanel({
  flights,
  onSelect,
}: {
  flights: FlightResult[];
  onSelect?: (f: FlightResult) => void;
}) {
  const [selected,   setSelected]   = useState<string | null>(null);
  const [sort,       setSort]       = useState<FlightSort>('price');
  const [stopFilter, setStopFilter] = useState<StopFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = flights.filter(f => {
    if (stopFilter === 'all') return true;
    if (stopFilter === '0')   return f.stops === 0;
    if (stopFilter === '1')   return f.stops === 1;
    return f.stops >= 2;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'price')    return a.price - b.price;
    if (sort === 'stops')    return a.stops - b.stops;
    // duration: parse "Xh Ym" → minutes
    const toMin = (d: string) => {
      const h = d.match(/(\d+)h/)?.[1] ?? '0';
      const m = d.match(/(\d+)m/)?.[1] ?? '0';
      return parseInt(h) * 60 + parseInt(m);
    };
    return toMin(a.duration) - toMin(b.duration);
  });

  const stopLabels: Record<StopFilter, string> = {
    all: 'All stops', '0': 'Non-stop', '1': '1 stop', '2+': '2+ stops',
  };
  const sortLabels: Record<FlightSort, string> = {
    price: 'Price', duration: 'Duration', stops: 'Stops',
  };

  const scroll = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  return (
    <div className="space-y-2">
      {/* Filter + sort bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
          <Plane className="w-3 h-3" />
          {flights.length} flight{flights.length !== 1 ? 's' : ''}
        </div>

        {/* Stop filter chips */}
        <div className="flex gap-1 ml-auto">
          {(['all', '0', '1', '2+'] as StopFilter[]).map(v => (
            <button
              key={v}
              onClick={() => setStopFilter(v)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
                stopFilter === v
                  ? 'bg-teal-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {stopLabels[v]}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as FlightSort)}
            className="appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs bg-muted text-muted-foreground border-0 cursor-pointer focus:outline-none"
          >
            {(['price', 'duration', 'stops'] as FlightSort[]).map(v => (
              <option key={v} value={v}>Sort: {sortLabels[v]}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Horizontal carousel */}
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No flights match this filter.
        </p>
      ) : (
        <div className="relative group/carousel">
          {/* Prev arrow — always visible on touch, hover-only on desktop */}
          {sorted.length > 1 && (
            <button
              onClick={() => scroll(-1)}
              aria-label="Previous flight"
              className="absolute left-1 top-1/2 -translate-y-1/2 z-10
                         w-8 h-8 rounded-full bg-card/90 border border-border shadow-lg
                         flex items-center justify-center transition-opacity
                         hover:bg-muted touch-manipulation backdrop-blur-sm
                         opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100"
            >
              <ChevronLeft className="w-4 h-4 text-foreground" />
            </button>
          )}

          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2
                       touch-pan-x
                       [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
          >
            {sorted.map(f => (
              // w-[85vw] on mobile so user sees the edge of the next card (peek pattern)
              // sm:w-[300px] restores desktop size
              <div key={f.id} className="flex-none w-[min(85vw,300px)] sm:w-[300px] snap-start animate-fade-in-up">
                <FlightCard
                  flight={f}
                  selected={selected === f.id}
                  onSelect={(fl) => {
                    setSelected(fl.id);
                    onSelect?.(fl);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Next arrow */}
          {sorted.length > 1 && (
            <button
              onClick={() => scroll(1)}
              aria-label="Next flight"
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10
                         w-8 h-8 rounded-full bg-card/90 border border-border shadow-lg
                         flex items-center justify-center transition-opacity
                         hover:bg-muted touch-manipulation backdrop-blur-sm
                         opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100"
            >
              <ChevronRight className="w-4 h-4 text-foreground" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hotel results panel with filter + sort ───────────────────────────────────
type HotelSort  = 'price' | 'rating' | 'stars';
type StarFilter = 'all' | '3' | '4' | '5';

function HotelResultsPanel({
  hotels,
  onSelect,
}: {
  hotels: HotelResult[];
  onSelect?: (h: HotelResult) => void;
}) {
  const [selected,    setSelected]    = useState<string | null>(null);
  const [sort,        setSort]        = useState<HotelSort>('price');
  const [starFilter,  setStarFilter]  = useState<StarFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = hotels.filter(h => {
    if (starFilter === 'all') return true;
    return h.stars >= parseInt(starFilter);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'price')  return a.pricePerNight - b.pricePerNight;
    if (sort === 'rating') return b.rating - a.rating;
    return b.stars - a.stars;
  });

  const starLabels: Record<StarFilter, string> = {
    all: 'All', '3': '3★+', '4': '4★+', '5': '5★',
  };
  const sortLabels: Record<HotelSort, string> = {
    price: 'Price', rating: 'Rating', stars: 'Stars',
  };

  const scroll = (dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: 'smooth' });
  };

  return (
    <div className="space-y-2">
      {/* Filter + sort bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
          <Building2 className="w-3 h-3" />
          {hotels.length} hotel{hotels.length !== 1 ? 's' : ''}
        </div>

        {/* Star filter chips */}
        <div className="flex gap-1 ml-auto">
          {(['all', '3', '4', '5'] as StarFilter[]).map(v => (
            <button
              key={v}
              onClick={() => setStarFilter(v)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
                starFilter === v
                  ? 'bg-teal-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {starLabels[v]}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as HotelSort)}
            className="appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs bg-muted text-muted-foreground border-0 cursor-pointer focus:outline-none"
          >
            {(['price', 'rating', 'stars'] as HotelSort[]).map(v => (
              <option key={v} value={v}>Sort: {sortLabels[v]}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Horizontal carousel */}
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No hotels match this filter.
        </p>
      ) : (
        <div className="relative group/carousel">
          {/* Prev arrow — always visible on touch, hover-only on desktop */}
          {sorted.length > 1 && (
            <button
              onClick={() => scroll(-1)}
              aria-label="Previous hotel"
              className="absolute left-1 top-1/2 -translate-y-1/2 z-10
                         w-8 h-8 rounded-full bg-card/90 border border-border shadow-lg
                         flex items-center justify-center transition-opacity
                         hover:bg-muted touch-manipulation backdrop-blur-sm
                         opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100"
            >
              <ChevronLeft className="w-4 h-4 text-foreground" />
            </button>
          )}

          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2
                       touch-pan-x
                       [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
          >
            {sorted.map(h => (
              <div key={h.id} className="flex-none w-[min(85vw,260px)] sm:w-[260px] snap-start animate-fade-in-up">
                <HotelCard
                  hotel={h}
                  selected={selected === h.id}
                  onSelect={(ht) => {
                    setSelected(ht.id);
                    onSelect?.(ht);
                  }}
                />
              </div>
            ))}
          </div>

          {/* Next arrow */}
          {sorted.length > 1 && (
            <button
              onClick={() => scroll(1)}
              aria-label="Next hotel"
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10
                         w-8 h-8 rounded-full bg-card/90 border border-border shadow-lg
                         flex items-center justify-center transition-opacity
                         hover:bg-muted touch-manipulation backdrop-blur-sm
                         opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100"
            >
              <ChevronRight className="w-4 h-4 text-foreground" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Experience results panel ─────────────────────────────────────────────────
type ExpCategoryFilter = 'all' | 'Museum' | 'Nature' | 'Landmark' | 'Adventure' | 'Entertainment' | 'Beach' | 'Food & Drink';

function ExperienceResultsPanel({ experiences }: { experiences: ExperienceResult[] }) {
  const [catFilter, setCatFilter] = useState<ExpCategoryFilter>('all');

  // Build unique category chips from actual results
  const availableCategories = Array.from(new Set(experiences.map(e => e.category))).slice(0, 5);

  const filtered = catFilter === 'all'
    ? experiences
    : experiences.filter(e => e.category === catFilter);

  return (
    <div className="space-y-2">
      {/* Header + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
          <Compass className="w-3 h-3" />
          {experiences.length} experience{experiences.length !== 1 ? 's' : ''}
        </div>
        <div className="flex gap-1 flex-wrap ml-auto">
          <button
            onClick={() => setCatFilter('all')}
            className={cn(
              'px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
              catFilter === 'all'
                ? 'bg-teal-600 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            All
          </button>
          {availableCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat as ExpCategoryFilter)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors',
                catFilter === cat
                  ? 'bg-teal-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Cards in a responsive grid — 1 col on very small phones, 2 col otherwise */}
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No experiences match this filter.</p>
      ) : (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
          {filtered.map(exp => (
            <div key={exp.id} className="animate-fade-in-up">
              <ExperienceCard experience={exp} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Booking confirmation card ─────────────────────────────────────────────────
function BookingCard({ data, type }: { data: BookingConfirmation; type?: string }) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: data.currency ?? 'USD' }).format(n);

  const isHotel    = type === 'hotel_booking_confirmed' || data.type === 'hotel';
  const fee        = data.serviceFee ?? 20;
  const fare       = data.fareAmount ?? (data.total > fee ? data.total - fee : data.total);
  const grandTotal = fare + fee;
  const statusVal  = (data.status ?? 'confirmed').toLowerCase();

  return (
    <div className="confirmation-card mt-2">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <span className="font-bold text-foreground">
          {isHotel ? '🏨 Hotel Confirmed!' : '✈ Flight Confirmed!'}
        </span>
        <span className={cn(
          'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full',
          statusVal === 'confirmed'
            ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        )}>
          {statusVal.toUpperCase()}
        </span>
      </div>

      <div className="space-y-1.5 text-sm">
        {/* Reference / Booking ID */}
        <div className="flex justify-between items-center pb-2 border-b border-border">
          <span className="text-muted-foreground">
            {isHotel ? 'Booking ID' : 'Booking Reference'}
          </span>
          <code className="font-mono font-bold text-base tracking-widest text-foreground">
            {data.bookingId ?? data.reference}
          </code>
        </div>

        {/* Hotel-specific fields */}
        {isHotel && data.hotelName && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Hotel</span>
            <span className="text-foreground font-medium">{data.hotelName}</span>
          </div>
        )}
        {isHotel && data.checkIn && data.checkOut && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dates</span>
            <span className="text-foreground">{data.checkIn} → {data.checkOut}</span>
          </div>
        )}

        {/* Fare / room cost */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">{isHotel ? 'Room Total' : 'Flight Fare'}</span>
          <span className="text-foreground">{fmt(fare)}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-muted-foreground">FlexeTravels Service Fee</span>
          <span className="text-foreground">{fmt(fee)}</span>
        </div>

        <div className="flex justify-between pt-2 border-t border-border">
          <span className="font-semibold text-foreground">Total</span>
          <span className="font-bold text-lg text-foreground">{fmt(grandTotal)}</span>
        </div>

        {data.email && (
          <p className="text-xs text-muted-foreground pt-1 border-t border-border">
            Confirmation sent to {data.email}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground pt-1">
          {isHotel
            ? 'Hotel charged via LiteAPI · Service fee charged separately by FlexeTravels'
            : 'Flight charged by Duffel · Service fee charged separately by FlexeTravels'
          }
        </p>
      </div>
    </div>
  );
}

// ─── Tool call status pill ────────────────────────────────────────────────────
interface ToolCallStatusProps {
  toolName: string;
  state: 'call' | 'result';
}

export function ToolCallStatus({ toolName, state }: ToolCallStatusProps) {
  const labels: Record<string, string> = {
    searchFlights:          '✈ Searching flights...',
    searchBookableFlights:  '✈ Finding bookable flights...',
    searchHotels:           '🏨 Searching hotels...',
    searchExperiences:      '🧭 Finding experiences...',
    bookFlight:             '📋 Booking flight...',
    preBookHotel:           '🏨 Holding hotel room...',
    confirmHotelBooking:    '✅ Confirming hotel booking...',
    getDestinationGuide:    '🗺 Loading destination guide...',
    getSimilarDestinations: '💡 Finding alternatives...',
    getPriceInsight:        '📊 Checking prices...',
    getDestinationImage:    '📸 Fetching image...',
  };
  const doneLabels: Record<string, string> = {
    searchFlights:          '✈ Flights found',
    searchBookableFlights:  '✈ Bookable flights found',
    searchHotels:           '🏨 Hotels found',
    searchExperiences:      '🧭 Experiences found',
    bookFlight:             '✅ Flight booked',
    preBookHotel:           '🏨 Room held',
    confirmHotelBooking:    '✅ Hotel booked',
    getDestinationGuide:    '🗺 Guide ready',
    getSimilarDestinations: '💡 Alternatives ready',
    getPriceInsight:        '📊 Price insight ready',
    getDestinationImage:    '📸 Image ready',
  };

  const label = state === 'call'
    ? (labels[toolName]     ?? `⚙ Running ${toolName}...`)
    : (doneLabels[toolName] ?? `✓ ${toolName} done`);

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium my-1',
      state === 'call'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
    )}>
      {state === 'call' && (
        <span className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
      )}
      {label}
    </div>
  );
}

// ─── Main ChatMessage component ────────────────────────────────────────────────
interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  toolCalls?: Array<{ toolName: string; state: 'call' | 'result' }>;
  onSelectFlight?: (f: FlightResult) => void;
  onSelectHotel?:  (h: HotelResult)  => void;
}

export function ChatMessage({
  role,
  content,
  streaming = false,
  toolCalls,
  onSelectFlight,
  onSelectHotel,
}: ChatMessageProps) {

  // ── User bubble ────────────────────────────────────────────────────────────
  if (role === 'user') {
    return (
      <div className="msg-row-user">
        <div className="bubble-user whitespace-pre-wrap break-words">{content}</div>
      </div>
    );
  }

  // ── Assistant bubble — STREAMING state ────────────────────────────────────
  // While the AI is still generating we ONLY show tool status pills + a stable
  // composing indicator.  We deliberately skip all card parsing during streaming
  // to prevent layout thrashing / flicker from incremental partial-JSON output.
  if (streaming) {
    return (
      <div className="msg-row-bot">
        <div className="bot-avatar flex-shrink-0 self-start mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {/* Live tool status pills */}
          {toolCalls && toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {toolCalls.map((tc, i) => (
                <ToolCallStatus key={i} toolName={tc.toolName} state={tc.state} />
              ))}
            </div>
          )}
          {/* Stable composing placeholder — no partial content shown */}
          <ComposingBlock toolCalls={toolCalls ?? []} />
        </div>
      </div>
    );
  }

  // ── Assistant bubble — COMPLETE state ─────────────────────────────────────
  // Only reached once streaming=false, so all card JSON is fully formed.
  const cards      = parseEmbeddedCards(content);
  const renderText = stripCardTags(content);

  const flightCards       = cards.filter(c => c.type === 'flight').map(c => c.data as FlightResult);
  const hotelCards        = cards.filter(c => c.type === 'hotel').map(c => c.data as HotelResult);
  const experienceCards   = cards.filter(c => c.type === 'experience').map(c => c.data as ExperienceResult);
  const bookingCards      = cards.filter(c => c.type === 'booking_confirmed').map(c => ({ data: c.data as BookingConfirmation, type: 'booking_confirmed' }));
  const hotelBookingCards = cards.filter(c => c.type === 'hotel_booking_confirmed').map(c => ({ data: c.data as BookingConfirmation, type: 'hotel_booking_confirmed' }));
  const allBookingCards   = [...bookingCards, ...hotelBookingCards];
  const paymentCards      = cards.filter(c => c.type === 'payment_required').map(c => c.data as PaymentRequiredData);

  return (
    <div className="msg-row-bot group animate-fade-in-up">
      <div className="bot-avatar flex-shrink-0 self-start mt-0.5">
        <Bot className="w-4 h-4" />
      </div>

      <div className="flex flex-col gap-3 min-w-0 flex-1">
        {/* Tool call status pills (completed state) */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {toolCalls.map((tc, i) => (
              <ToolCallStatus key={i} toolName={tc.toolName} state={tc.state} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {renderText && (
          <div className="bubble-bot group relative">
            <div className="absolute top-2 right-2 z-10">
              <CopyButton text={renderText} />
            </div>
            <div className="prose-chat pr-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    return (
                      <code className={cn('font-mono text-xs', className)} {...props}>
                        {children}
                      </code>
                    );
                  },
                  a({ href, children }) {
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {renderText}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Flight results */}
        {flightCards.length > 0 && (
          <FlightResultsPanel flights={flightCards} onSelect={onSelectFlight} />
        )}

        {/* Hotel results */}
        {hotelCards.length > 0 && (
          <HotelResultsPanel hotels={hotelCards} onSelect={onSelectHotel} />
        )}

        {/* Experience results */}
        {experienceCards.length > 0 && (
          <ExperienceResultsPanel experiences={experienceCards} />
        )}

        {/* Booking confirmations */}
        {allBookingCards.map((bc, i) => (
          <BookingCard key={i} data={bc.data} type={bc.type} />
        ))}

        {/* Stripe service fee payment form */}
        {paymentCards.map((pd, i) => (
          <StripePaymentForm key={i} data={pd} />
        ))}

        {/* Feedback row — thumbs up/down */}
        {!streaming && renderText && (
          <MessageFeedback />
        )}
      </div>
    </div>
  );
}

// ─── Message feedback (thumbs up / down) ────────────────────────────────────
function MessageFeedback() {
  const [vote, setVote] = useState<'up' | 'down' | null>(null);

  const handleVote = (v: 'up' | 'down') => {
    if (vote === v) { setVote(null); return; }
    setVote(v);
    // Stub: log to console — wire up to /api/feedback when ready
    console.info('[feedback]', v);
  };

  return (
    <div className="flex items-center gap-1 mt-0.5 opacity-0 group-hover:opacity-100
                    focus-within:opacity-100 transition-opacity duration-150">
      <button
        type="button"
        onClick={() => handleVote('up')}
        title="Good response"
        className={cn(
          'p-1.5 rounded-lg transition-colors touch-manipulation',
          vote === 'up'
            ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleVote('down')}
        title="Poor response"
        className={cn(
          'p-1.5 rounded-lg transition-colors touch-manipulation',
          vote === 'down'
            ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      {vote && (
        <span className="text-[11px] text-muted-foreground ml-0.5 transition-opacity">
          {vote === 'up' ? 'Thanks!' : 'Got it, I\'ll do better.'}
        </span>
      )}
    </div>
  );
}
