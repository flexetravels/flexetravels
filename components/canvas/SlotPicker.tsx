'use client';

// SlotPicker — slide-over Sheet for picking a flight or hotel for a canvas leg.
// Issues a fresh search to /api/search/flights or /api/search/hotels, displays
// compact result cards, and dispatches set_flight / set_hotel on click.

import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Plane, Hotel, Sparkles, ChevronLeft, ChevronRight, MapPin, Wifi, Car, UtensilsCrossed, Waves, Dumbbell, Wind, Coffee, Loader2 } from 'lucide-react';
import {
  type CanvasFlightSelection, type CanvasHotelSelection, type CanvasLeg, type CanvasState,
} from '@/lib/canvas/types';
import { resolveIata } from '@/lib/canvas/airport-coords';
import {
  categorizePhotos, bucketPhotos, pickRoomPhoto,
  CATEGORY_LABELS, type PhotoCategory,
} from '@/lib/canvas/hotel-photos';

interface NormalizedFlight {
  id:        string;
  airline:   string;
  origin:    string;
  destination: string;
  departure: string;
  arrival:   string;
  duration:  string;
  stops:     number;
  price:     number;
  currency:  string;
  cabinClass?: string;
  stopAirports?: string[];
  baggage?: string;
  refundable?: boolean;
  flexibilitySummary?: string;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnStops?: number;
  returnStopAirports?: string[];
  returnSegments?: Array<{
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    duration: string;
    flightNumber: string;
    carrier: string;
    operatingCarrier?: string;
  }>;
  legs?:     Array<{
    origin: string;
    destination: string;
    departure?: string;
    arrival?: string;
    duration?: string;
    stops?: number;
    stopAirports?: string[];
    segments: Array<{
      origin: string;
      destination: string;
      departure: string;
      arrival: string;
      duration: string;
      flightNumber: string;
      carrier: string;
      operatingCarrier?: string;
    }>;
  }>;
  fareVariants?: Array<{ flexibilityLabel?: 'Flexible' | 'Moderate' | 'Locked' }>;
}

interface NormalizedHotel {
  id:        string;
  name:      string;
  location?: string;
  address?:  string;
  city?:     string;
  // Real API field names — matches lib/search/types.ts → NormalizedHotel
  stars:         number;
  rating:        number;          // 0–10 guest score (synthetic baseline)
  reviewCount?:  number;
  // Real Google Places review score, populated post-search by the aggregator
  // when GOOGLE_PLACES_API_KEY is set. UI prefers this over `rating`.
  googleRating?:      number;     // 0–5 (Places scale)
  googleRatingCount?: number;
  pricePerNight: number;
  totalPrice:    number;
  currency:      string;
  cancellation?: string;
  image?:        string;
  bookingToken?: string;
  // Enriched fields used by the detail view + filter chips
  boardType?:    string;          // "RO" | "BB" | "HB" | "FB" | "AI"
  boardName?:    string;          // "Bed & Breakfast", "All-Inclusive" etc.
  refundableTag?: string;         // "RFN" → free cancellation
  maxOccupancy?: number;
  cancelPolicies?: Array<{ cancelTime?: string; amount?: number; description?: string; type?: string; currency?: string }>;
  taxesAndFees?:   Array<{ description?: string; amount?: number; included?: boolean; currency?: string }>;
  // All room types LiteAPI returned for this hotel — used to populate the
  // Rooms picker inside the detail view so users can compare options.
  allRoomTypes?: Array<{
    offerId?:      string;
    name?:         string;
    maxOccupancy?: number;
    rates?: Array<{
      rateId?:     string;
      name?:       string;
      boardType?:  string;
      boardName?:  string;
      price?:      number;       // Total for the stay (LiteAPI quirk)
      currency?:   string;
      commission?: number;
      refundable?: boolean;
    }>;
  }>;
}

interface Props {
  open:      boolean;
  onClose:   () => void;
  leg:       CanvasLeg;
  legIndex:  number;
  state:     CanvasState;
  tripId:    string;
  sessionId: string;
  kind:      'flight' | 'hotel';
  onPickFlight?: (flight: CanvasFlightSelection) => void;
  onPickHotel?:  (hotel:  CanvasHotelSelection)  => void;
  onSetHomeOrigin?: (iata: string) => void;   // called when user sets home airport inline
}

export function SlotPicker(props: Props) {
  const { open, onClose, kind } = props;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg lg:max-w-xl bg-navy-950 border-l border-navy-500/40 text-navy-100 p-0 overflow-hidden flex flex-col"
      >
        <SheetHeader className="px-5 py-4 border-b border-navy-500/30">
          <SheetTitle className="text-white text-lg flex items-center gap-2">
            {kind === 'flight'
              ? <><Plane className="w-4 h-4 text-teal-400" /> Pick a flight</>
              : <><Hotel className="w-4 h-4 text-teal-400" /> Pick a hotel</>}
          </SheetTitle>
          <SheetDescription className="text-navy-300 text-sm">
            {kind === 'flight'
              ? `Flying into ${props.leg.city}${props.leg.iata ? ` (${props.leg.iata})` : ''}`
              : `Staying in ${props.leg.city} · ${props.leg.startDate} → ${props.leg.endDate}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {kind === 'flight'
            ? <FlightResults {...props} />
            : <HotelResults {...props} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Flight results ──────────────────────────────────────────────────────────

function FlightResults({ leg, legIndex, state, tripId, sessionId, onPickFlight, onClose, onSetHomeOrigin }: Props) {
  const [results, setResults] = useState<NormalizedFlight[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'price' | 'duration'>('price');
  const [sandbox, setSandbox] = useState(false);

  // Determine origin: previous leg's iata/city, or homeOrigin for the first leg
  const origin = useMemo(() => {
    if (legIndex > 0) {
      const prev = state.legs[legIndex - 1];
      return prev?.iata || prev?.city || '';
    }
    return state.homeOrigin || '';
  }, [legIndex, state]);

  const destination = leg.iata || leg.city;

  // Need a home origin for the very first leg — show inline form
  const needsHomeOrigin = legIndex === 0 && !state.homeOrigin;

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);

    if (needsHomeOrigin) return;     // inline form will collect it; don't search yet
    if (!origin) {
      setError('Set your home airport first to search flights.');
      return;
    }
    if (!destination || destination.length < 2) {
      setError('Add a destination airport (IATA code) to search.');
      return;
    }

    (async () => {
      try {
        // Resolve city / IATA via Duffel's authoritative /places/suggestions.
        // The local airport-coords table is just a fast-path for the most
        // common cities; anything Duffel knows we accept verbatim. Two
        // lookups in parallel — origin + destination — keep this fast.
        const [originIata, destinationIata] = await Promise.all([
          liveResolveIata(origin),
          liveResolveIata(destination),
        ]);
        if (!originIata) {
          setError(`Couldn't find an airport for "${origin}". Try a major city name or a 3-letter IATA code.`);
          return;
        }
        if (!destinationIata) {
          setError(`Couldn't find an airport for "${destination}". Try a major city name or a 3-letter IATA code.`);
          return;
        }
        // Real ages from state when set; otherwise default to age 8 per child
        // so the search at least bills for them. Ages <2 become "infants".
        const ages = (() => {
          const c   = state.travellers.children;
          if (c <= 0) return [] as number[];
          const set = state.travellers.childAges ?? [];
          return Array.from({ length: c }, (_, i) => {
            const a = set[i];
            return Number.isFinite(a) ? Math.max(0, Math.min(17, Math.floor(a as number))) : 8;
          });
        })();
        const childrenAges = ages.filter(a => a >= 2);
        const infants      = ages.filter(a => a <  2).length;

        const res = await fetch('/api/search/flights', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            origin:        originIata,
            destination:   destinationIata,
            departureDate: leg.startDate,
            sessionId,
            tripCanvasId:  tripId,
            legId:         leg.id,
            searchIntent:  `canvas flight picker leg ${legIndex + 1}`,
            adults:        state.travellers.adults,
            childrenAges:  childrenAges.length > 0 ? childrenAges : undefined,
            infants:       infants > 0 ? infants : undefined,
            cabinClass:    'economy',
            transitProfile: state.meta.travelDocs?.passportCountry
              ? {
                  passportCountry: state.meta.travelDocs.passportCountry,
                  visaCountries: state.meta.travelDocs.visaCountries,
                  mode: 'filter',
                }
              : undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError(data.error || `Search failed (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setResults(Array.isArray(data.flights) ? data.flights : []);
          setSandbox(!!data.sandbox);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      }
    })();

    return () => { cancelled = true; };
  }, [origin, destination, leg.startDate, state.travellers.adults, state.travellers.children, state.meta.travelDocs?.passportCountry, state.meta.travelDocs?.visaCountries?.join(',')]);

  const sorted = useMemo(() => {
    if (!results) return null;
    const copy = [...results];
    if (sortKey === 'price') copy.sort((a, b) => a.price - b.price);
    else copy.sort((a, b) => parseDur(a.duration) - parseDur(b.duration));
    return copy;
  }, [results, sortKey]);

  return (
    <div>
      {needsHomeOrigin && (
        <HomeOriginForm onSubmit={(iata) => onSetHomeOrigin?.(iata)} />
      )}

      {!needsHomeOrigin && (
      <div className="px-5 py-3 border-b border-navy-500/30 flex items-center justify-between">
        <p className="text-xs text-navy-300 font-mono uppercase tracking-wider">
          {sorted ? `${sorted.length} flights` : 'Searching…'}
        </p>
        <div className="flex items-center gap-1">
          <SortChip active={sortKey === 'price'}    onClick={() => setSortKey('price')}>Cheapest</SortChip>
          <SortChip active={sortKey === 'duration'} onClick={() => setSortKey('duration')}>Fastest</SortChip>
        </div>
      </div>
      )}

      {!needsHomeOrigin && !state.meta.travelDocs?.passportCountry && (
        <div className="px-5 py-2 text-[11px] text-amber-200/95 bg-amber-500/8 border-b border-amber-500/25">
          Add passport / transit visa details in the trip header to hide routings that may require a transit visa.
        </div>
      )}

      {!needsHomeOrigin && state.meta.travelDocs?.passportCountry && (
        <div className="px-5 py-2 text-[11px] text-teal-200/95 bg-teal-500/8 border-b border-teal-500/20">
          Filtering transit-risk flights for {state.meta.travelDocs.passportCountry} passport
          {state.meta.travelDocs.visaCountries?.length ? ` with ${state.meta.travelDocs.visaCountries.join(', ')} status marked as held` : ''}.
        </div>
      )}

      {!needsHomeOrigin && error && (
        <div className="px-5 py-12 text-center">
          <p className="text-amber-400 text-sm mb-4">{error}</p>
          <Button onClick={onClose} variant="outline" className="border-navy-500/40 text-navy-200">Close</Button>
        </div>
      )}

      {!needsHomeOrigin && !error && !sorted && (
        <div className="p-5 space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 bg-navy-800/40" />
          ))}
        </div>
      )}

      {!needsHomeOrigin && sorted && sorted.length === 0 && (
        <div className="px-5 py-12 text-center">
          <p className="text-navy-200 italic mb-2" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            No flights match for these dates.
          </p>
          <p className="text-navy-400 text-sm">Try adjusting the date or destination.</p>
        </div>
      )}

      {sandbox && sorted && sorted.length > 0 && <SandboxBanner kind="flight" />}

      {!needsHomeOrigin && sorted && sorted.length > 0 && (
        <ul className="px-3 py-3 space-y-2">
          {sorted.map(f => (
            <li key={f.id}>
              <FlightOptionCard flight={f} onPick={() => {
                onPickFlight?.(toCanvasFlight(f, {
                  adults:    state.travellers.adults,
                  children:  state.travellers.children,
                  childAges: state.travellers.childAges,
                }));
                onClose();
              }} />
            </li>
          ))}
        </ul>
      )}
      {/* helper anchor — hotel list is in HotelResults, not here */}
    </div>
  );
}

// Single small banner reused at the top of flight + hotel result lists when
// the search response says we're hitting a sandbox key. Avoids the user
// thinking "Mock Air 9999, $42" is the actual fare.
function SandboxBanner({ kind }: { kind: 'flight' | 'hotel' }) {
  return (
    <div className="px-5 py-2 text-[11px] text-amber-300/95 bg-amber-500/8 border-b border-amber-500/25 flex items-center gap-2">
      <span aria-hidden>⚠</span>
      <span>
        <strong className="font-semibold">Sandbox / test data.</strong>{' '}
        These {kind === 'flight' ? 'flights' : 'hotels'} are mock results from the {kind === 'flight' ? 'Duffel' : 'LiteAPI'} sandbox —
        prices and availability are not real. Switch to the production key to book.
      </span>
    </div>
  );
}

// ─── Home origin inline form ─────────────────────────────────────────────────
// Shown only when the user clicks the first leg's flight slot before setting
// a home airport. Once submitted, the parent updates state.homeOrigin which
// causes the search useEffect to fire.

function HomeOriginForm({ onSubmit }: { onSubmit: (iata: string) => void }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  // Same lightweight city → IATA fallback table the search uses
  const tryNormalize = (raw: string): string | null => {
    const s = raw.trim();
    if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
    const map: Record<string, string> = {
      toronto: 'YYZ', vancouver: 'YVR', montreal: 'YUL', calgary: 'YYC',
      'new york': 'JFK', nyc: 'JFK', 'los angeles': 'LAX', la: 'LAX',
      chicago: 'ORD', boston: 'BOS', seattle: 'SEA', miami: 'MIA',
      london: 'LHR', paris: 'CDG', tokyo: 'NRT', dubai: 'DXB',
      mumbai: 'BOM', delhi: 'DEL', bangalore: 'BLR', bengaluru: 'BLR',
      chennai: 'MAA', hyderabad: 'HYD',
    };
    return map[s.toLowerCase()] ?? null;
  };

  const normalized = tryNormalize(value);
  const error = touched && !normalized
    ? 'Enter a 3-letter airport code (e.g. YYZ, JFK, LHR) or a major city name.'
    : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!normalized) return;
    onSubmit(normalized);
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-6">
      <p className="text-xs uppercase tracking-[0.18em] text-teal-400 font-mono mb-3">First, where are you flying from?</p>
      <p className="italic text-navy-100 text-lg mb-4" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
        Set your home airport so we can search the right flights.
      </p>
      <div className="flex items-stretch gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="YYZ, Toronto, JFK…"
          className="flex-1 h-10 px-3 rounded-md bg-navy-800/60 border border-navy-500/40 text-white placeholder:text-navy-400 focus:border-teal-500/60 focus:outline-none text-sm uppercase tracking-wider font-mono"
          maxLength={32}
        />
        <button
          type="submit"
          className="h-10 px-4 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium disabled:opacity-50"
          disabled={!normalized}
        >
          Set home
        </button>
      </div>
      {error && <p className="mt-2 text-amber-400 text-xs">{error}</p>}
      {normalized && (
        <p className="mt-2 text-xs text-navy-300">
          We&apos;ll search flights from <span className="text-teal-400 font-mono">{normalized}</span>.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {['YYZ', 'YVR', 'JFK', 'LAX', 'LHR', 'BLR', 'BOM', 'DEL'].map(code => (
          <button
            key={code}
            type="button"
            onClick={() => { setValue(code); setTouched(false); }}
            className="h-7 px-2.5 rounded-md border border-navy-500/40 text-[11px] text-navy-300 hover:text-white hover:border-teal-500/40 font-mono"
          >
            {code}
          </button>
        ))}
      </div>
    </form>
  );
}

function FlightOptionCard({ flight, onPick }: { flight: NormalizedFlight; onPick: () => void }) {
  const flexLabel = flight.fareVariants?.[0]?.flexibilityLabel || 'Moderate';
  const flexClass = flexLabel === 'Flexible'
    ? 'bg-teal-500/10 text-teal-400'
    : flexLabel === 'Locked'
    ? 'bg-amber-500/10 text-amber-400'
    : 'bg-navy-700/60 text-navy-200';
  const flightNum = flight.legs?.[0]?.segments?.[0]?.flightNumber || '';
  const segments = flight.legs?.[0]?.segments ?? [];

  return (
    <button
      onClick={onPick}
      className="w-full text-left rounded-lg p-4 hairline-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-9 w-9 rounded-md bg-navy-700 flex items-center justify-center" style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}>
            <Plane className="w-4 h-4 text-teal-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
            <span className="text-sm font-mono text-navy-50 tracking-wide">{flight.origin} → {flight.destination}</span>
            <span className="text-xs text-navy-300">{flight.airline}</span>
            {flightNum && <span className="text-xs text-navy-400 font-mono">{flightNum}</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-navy-300">
            <span className="tabular-nums">{flight.duration}</span>
            <span>·</span>
            <span>{flight.stops === 0 ? 'nonstop' : `${flight.stops} stop${flight.stops === 1 ? '' : 's'}`}</span>
            <span className={`px-1.5 py-0.5 rounded-md ${flexClass} text-[10px] font-medium uppercase tracking-wider`}>{flexLabel}</span>
          </div>
          {segments.length > 0 && (
            <div className="mt-3 rounded-md bg-navy-950/45 border border-navy-600/35 px-3 py-2 space-y-1.5">
              {segments.map((seg, i) => {
                const layover = i < segments.length - 1 ? layoverDuration(seg.arrival, segments[i + 1].departure) : null;
                return (
                  <div key={`${seg.flightNumber}-${i}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-navy-200">
                      <span className="font-mono text-navy-100">
                        {seg.origin} → {seg.destination}
                      </span>
                      <span className="tabular-nums text-navy-300">
                        {formatFlightClock(seg.departure)} → {formatFlightClock(seg.arrival)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-navy-400">
                      <span>{seg.flightNumber}</span>
                      {seg.operatingCarrier && seg.operatingCarrier !== seg.carrier && (
                        <span>operated by {seg.operatingCarrier}</span>
                      )}
                      <span>{seg.duration}</span>
                    </div>
                    {layover && (
                      <p className="text-[10px] text-amber-300/90">
                        Layover in {seg.destination}: {layover}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-base font-semibold text-white tabular-nums">${flight.price.toFixed(0)} <span className="text-xs text-navy-300 font-normal">{flight.currency || 'USD'}</span></p>
          <p className="mt-1 text-[11px] text-teal-400 font-mono">[ pick ]</p>
        </div>
      </div>
    </button>
  );
}

// ─── Hotel results ───────────────────────────────────────────────────────────

function HotelResults({ leg, legIndex, state, tripId, sessionId, onPickHotel, onClose }: Props) {
  const [results, setResults] = useState<NormalizedHotel[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'price' | 'rating'>('price');
  const [viewingDetail, setViewingDetail] = useState<NormalizedHotel | null>(null);
  const [sandbox, setSandbox] = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filterQuery,    setFilterQuery]   = useState('');
  const [minStars,       setMinStars]      = useState<0 | 3 | 4 | 5>(0);
  const [maxPrice,       setMaxPrice]      = useState<number | null>(null);
  const [boardFilter,    setBoardFilter]   = useState<'any' | 'BB' | 'AI' | 'free-cancel'>('any');

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);

    if (!leg.city || leg.city.length < 2) {
      setError('Add a destination city to search hotels.');
      return;
    }

    (async () => {
      try {
        // Hotels: every child counts toward occupancy, including infants.
        const c    = state.travellers.children;
        const set  = state.travellers.childAges ?? [];
        const ages = c > 0
          ? Array.from({ length: c }, (_, i) => {
              const a = set[i];
              return Number.isFinite(a) ? Math.max(0, Math.min(17, Math.floor(a as number))) : 8;
            })
          : [];

        const res = await fetch('/api/search/hotels', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            destination: leg.city,
            checkIn:     leg.startDate,
            checkOut:    leg.endDate,
            sessionId,
            tripCanvasId: tripId,
            legId:       leg.id,
            searchIntent: `canvas hotel picker leg ${legIndex + 1}`,
            adults:      state.travellers.adults,
            childrenAges: ages.length > 0 ? ages : undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError(data.error || `Search failed (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setResults(Array.isArray(data.hotels) ? data.hotels : []);
          setSandbox(!!data.sandbox);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      }
    })();

    return () => { cancelled = true; };
  }, [leg.city, leg.startDate, leg.endDate, state.travellers.adults, state.travellers.children]);

  const sorted = useMemo(() => {
    if (!results) return null;
    let copy = [...results];

    // ── Apply filters ─────────────────────────────────────────────────────
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      copy = copy.filter(h =>
        h.name.toLowerCase().includes(q) ||
        (h.location ?? '').toLowerCase().includes(q) ||
        (h.address ?? '').toLowerCase().includes(q),
      );
    }
    if (minStars > 0) {
      copy = copy.filter(h => (h.stars ?? 0) >= minStars);
    }
    if (maxPrice && maxPrice > 0) {
      copy = copy.filter(h => h.pricePerNight <= maxPrice);
    }
    if (boardFilter === 'BB') {
      copy = copy.filter(h => h.boardType === 'BB' || /breakfast/i.test(h.boardName ?? ''));
    } else if (boardFilter === 'AI') {
      copy = copy.filter(h => h.boardType === 'AI' || /all.?inclusive/i.test(h.boardName ?? ''));
    } else if (boardFilter === 'free-cancel') {
      copy = copy.filter(h => h.refundableTag === 'RFN' || /free.+cancel/i.test(h.cancellation ?? ''));
    }

    // ── Sort ──────────────────────────────────────────────────────────────
    if (sortKey === 'price') {
      copy.sort((a, b) => a.pricePerNight - b.pricePerNight);
    } else {
      copy.sort((a, b) => {
        const r = (b.rating ?? 0) - (a.rating ?? 0);
        if (r !== 0) return r;
        const c = (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
        if (c !== 0) return c;
        return a.pricePerNight - b.pricePerNight;
      });
    }
    return copy;
  }, [results, sortKey, filterQuery, minStars, maxPrice, boardFilter]);

  const filtersActive = filterQuery.trim() !== '' || minStars > 0 || (maxPrice ?? 0) > 0 || boardFilter !== 'any';
  const totalAvailable = results?.length ?? 0;

  // Surface to the user when the API didn't return ratings for any hotel —
  // the Top-rated sort can't do anything meaningful in that case.
  const ratingsAvailable = useMemo(
    () => (results ?? []).some(h => (h.rating ?? 0) > 0),
    [results],
  );

  // Detail view branch — full hotel info before user picks
  if (viewingDetail) {
    return (
      <HotelDetailView
        hotel={viewingDetail}
        nights={Math.max(1, Math.round((new Date(leg.endDate).getTime() - new Date(leg.startDate).getTime()) / 86400000))}
        onBack={() => setViewingDetail(null)}
        onPick={() => {
          onPickHotel?.(toCanvasHotel(viewingDetail, leg.city, {
            adults:    state.travellers.adults,
            children:  state.travellers.children,
            childAges: state.travellers.childAges,
          }));
          onClose();
        }}
      />
    );
  }

  return (
    <div>
      <div className="px-5 py-3 border-b border-navy-500/30 flex items-center justify-between gap-3">
        <p className="text-xs text-navy-300 font-mono uppercase tracking-wider whitespace-nowrap">
          {sorted ? (
            filtersActive
              ? `${sorted.length} of ${totalAvailable} hotels`
              : `${sorted.length} hotels`
          ) : 'Searching…'}
        </p>
        <div className="flex items-center gap-1">
          <SortChip active={sortKey === 'price'}  onClick={() => setSortKey('price')}>Cheapest</SortChip>
          <SortChip
            active={sortKey === 'rating'}
            onClick={() => setSortKey('rating')}
            disabled={sorted !== null && !ratingsAvailable}
            title={sorted !== null && !ratingsAvailable ? 'No guest ratings available for this city' : undefined}
          >
            Top-rated
          </SortChip>
        </div>
      </div>

      {/* Filter bar — name search + star + price + board type */}
      {results && results.length > 0 && (
        <div className="px-5 py-3 border-b border-navy-500/30 space-y-2.5">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-navy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 9.5a7.5 7.5 0 0013.15 7.15z"/></svg>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search by hotel name or area"
              className="w-full pl-8 pr-3 h-8 text-xs rounded-md bg-navy-800/60 border border-navy-500/40 text-white placeholder:text-navy-400 outline-none focus:border-teal-500/60"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Star rating */}
            <FilterChip active={minStars === 0}  onClick={() => setMinStars(0)}>Any stars</FilterChip>
            <FilterChip active={minStars === 3}  onClick={() => setMinStars(minStars === 3 ? 0 : 3)}>3+ ★</FilterChip>
            <FilterChip active={minStars === 4}  onClick={() => setMinStars(minStars === 4 ? 0 : 4)}>4+ ★</FilterChip>
            <FilterChip active={minStars === 5}  onClick={() => setMinStars(minStars === 5 ? 0 : 5)}>5 ★</FilterChip>
            <span className="text-navy-500 text-xs px-1">·</span>
            {/* Board type */}
            <FilterChip active={boardFilter === 'BB'}          onClick={() => setBoardFilter(boardFilter === 'BB' ? 'any' : 'BB')}>🥐 Breakfast</FilterChip>
            <FilterChip active={boardFilter === 'AI'}          onClick={() => setBoardFilter(boardFilter === 'AI' ? 'any' : 'AI')}>🌟 All-inclusive</FilterChip>
            <FilterChip active={boardFilter === 'free-cancel'} onClick={() => setBoardFilter(boardFilter === 'free-cancel' ? 'any' : 'free-cancel')}>Free cancel</FilterChip>
            <span className="text-navy-500 text-xs px-1">·</span>
            {/* Max price */}
            <PriceChip
              value={maxPrice}
              onChange={setMaxPrice}
              currency={results[0]?.currency || 'USD'}
            />
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setFilterQuery(''); setMinStars(0); setMaxPrice(null); setBoardFilter('any'); }}
                className="text-[11px] font-mono text-navy-300 hover:text-white"
                title="Clear all filters"
              >
                [ clear ]
              </button>
            )}
          </div>
        </div>
      )}

      {sorted !== null && !ratingsAvailable && sortKey === 'rating' && (
        <p className="px-5 py-2 text-[11px] text-amber-400 bg-amber-500/5 border-b border-navy-500/30">
          No guest ratings returned for this city — showing in price order instead.
        </p>
      )}

      {sorted && sorted.length === 0 && filtersActive && (
        <div className="px-5 py-10 text-center">
          <p className="text-navy-200 italic mb-2" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            No hotels match your filters.
          </p>
          <button
            type="button"
            onClick={() => { setFilterQuery(''); setMinStars(0); setMaxPrice(null); setBoardFilter('any'); }}
            className="text-xs font-mono text-teal-400 hover:text-teal-300"
          >
            [ clear filters ]
          </button>
        </div>
      )}

      {error && (
        <div className="px-5 py-12 text-center">
          <p className="text-amber-400 text-sm mb-4">{error}</p>
          <Button onClick={onClose} variant="outline" className="border-navy-500/40 text-navy-200">Close</Button>
        </div>
      )}

      {!error && !sorted && (
        <div className="p-5 space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-28 bg-navy-800/40" />
          ))}
        </div>
      )}

      {sorted && sorted.length === 0 && (
        <div className="px-5 py-12 text-center">
          <p className="text-navy-200 italic mb-2" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            No hotels found for these dates.
          </p>
          <p className="text-navy-400 text-sm">Try a slightly different city name (e.g. &quot;Paris&quot; instead of &quot;CDG&quot;).</p>
        </div>
      )}

      {sandbox && sorted && sorted.length > 0 && <SandboxBanner kind="hotel" />}

      {sorted && sorted.length > 0 && (
        <ul className="px-3 py-3 space-y-2">
          {sorted.map(h => (
            <li key={h.id}>
              <HotelOptionCard
                hotel={h}
                onViewDetails={() => setViewingDetail(h)}
                onPick={() => {
                  onPickHotel?.(toCanvasHotel(h, leg.city, {
                    adults:    state.travellers.adults,
                    children:  state.travellers.children,
                    childAges: state.travellers.childAges,
                  }));
                  onClose();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HotelOptionCard({
  hotel, onPick, onViewDetails,
}: {
  hotel: NormalizedHotel;
  onPick: () => void;
  onViewDetails: () => void;
}) {
  return (
    <div
      className="rounded-lg p-4 hairline-hover transition cursor-pointer"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}
      onClick={onViewDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewDetails(); } }}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <HotelThumb hotel={hotel} size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-navy-50 truncate">{hotel.name}</p>
          {(hotel.location || hotel.address) && (
            <p className="text-xs text-navy-300 truncate">{hotel.location || hotel.address}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-navy-300">
            {hotel.stars > 0 && <span className="text-amber-400">{'★'.repeat(Math.round(hotel.stars))}</span>}
            {/* Prefer Google's real review score over the synthetic stars-derived
                baseline. Falls back to the synthetic when Places isn't configured
                or didn't find this property. */}
            {typeof hotel.googleRating === 'number' && hotel.googleRatingCount && hotel.googleRatingCount > 0 ? (
              <span className="tabular-nums inline-flex items-center gap-1" title="Google review score">
                <span className="text-amber-400">★</span>
                {hotel.googleRating.toFixed(1)}
                <span className="text-navy-500">({formatRatingCount(hotel.googleRatingCount)})</span>
                <span className="text-[9px] uppercase tracking-wider text-navy-500 font-mono ml-0.5">google</span>
              </span>
            ) : hotel.rating > 0 ? (
              <span className="tabular-nums">{hotel.rating.toFixed(1)} <span className="text-navy-400">/ 10</span></span>
            ) : null}
            {hotel.reviewCount !== undefined && hotel.reviewCount > 0 && !hotel.googleRatingCount && (
              <span className="text-navy-400 tabular-nums">{hotel.reviewCount.toLocaleString()} reviews</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right flex flex-col items-end gap-1.5">
          <div>
            <p className="text-base font-semibold text-white tabular-nums">${hotel.pricePerNight.toFixed(0)}<span className="text-xs text-navy-300 font-normal">/n</span></p>
            <p className="text-xs text-navy-300 tabular-nums">${hotel.totalPrice.toFixed(0)} total</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPick(); }}
            className="px-2.5 h-7 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-medium"
          >
            Pick
          </button>
        </div>
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono flex items-center gap-1">
        <ChevronRight className="w-2.5 h-2.5" />
        Tap to see photos &amp; details
      </p>
    </div>
  );
}

// ─── Taxes & fees with roll-up + per-line explainer ────────────────────────

function TaxesAndFees({
  taxesAndFees, currency, totalPrice, countryCode,
}: {
  taxesAndFees: Array<{ description?: string; amount?: number; included?: boolean; currency?: string }>;
  currency:    string;
  totalPrice:  number;
  countryCode?: string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Sum the line amounts so we can show "$X total" + "Y% of room rate".
  // We use the user-facing `totalPrice` as the denominator for the % so the
  // ratio is intuitive ("taxes ate 18% of what I'm paying"). This also dodges
  // the included/not-included subtlety — any way you slice it, this is what
  // hits the customer's bill.
  const totalTaxesFees = taxesAndFees.reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const pctOfTotal = totalPrice > 0
    ? Math.round((totalTaxesFees / totalPrice) * 100)
    : 0;

  return (
    <div className="px-5 pb-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Taxes &amp; fees</p>

      {/* Roll-up summary — answers "how much of what I'm paying is tax?" */}
      <div className="mb-2.5 px-3 py-2 rounded-md bg-navy-900/40 hairline flex items-baseline justify-between gap-3 text-xs">
        <div>
          <p className="text-navy-100 font-medium">
            ${totalTaxesFees.toFixed(0)} {currency}
            <span className="text-navy-300 font-normal"> in taxes &amp; fees</span>
          </p>
          {pctOfTotal > 0 && (
            <p className="text-[10px] text-navy-400 mt-0.5">
              ~{pctOfTotal}% of the total · {countryCode ? `applied per ${countryCode} rules` : 'per local jurisdiction rules'}
            </p>
          )}
        </div>
      </div>

      <ul className="space-y-1 text-xs text-navy-200">
        {taxesAndFees.map((t, i) => {
          const label    = t.description || 'Tax';
          const explain  = explainTaxLine(label, countryCode);
          const expanded = expandedIdx === i;
          return (
            <li key={i} className="rounded-md hover:bg-navy-900/30">
              <div className="flex items-baseline justify-between gap-3 px-2 py-1">
                <span className="flex items-center gap-1.5">
                  <span>{label}{t.included ? ' (included)' : ''}</span>
                  {explain && (
                    <button
                      type="button"
                      onClick={() => setExpandedIdx(expanded ? null : i)}
                      aria-expanded={expanded}
                      aria-label={`What is ${label}?`}
                      className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-teal-500/40 text-[9px] font-semibold text-teal-400 hover:bg-teal-500/10 hover:text-teal-300"
                    >
                      i
                    </button>
                  )}
                </span>
                <span className="text-navy-300 tabular-nums flex-shrink-0">
                  {(t.amount ?? 0).toFixed(2)} {t.currency || currency}
                </span>
              </div>
              {expanded && explain && (
                <div className="px-2 pb-2 -mt-0.5 text-[11px] text-navy-300 leading-relaxed bg-navy-900/40 rounded-b-md border-l-2 border-teal-500/40 ml-2">
                  <p className="pl-2 pt-1.5">{explain}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortChip({
  active, onClick, children, disabled, title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 h-7 rounded-md text-[11px] font-medium transition flex items-center gap-1 ${
        active
          ? 'bg-teal-500/15 text-teal-400 border border-teal-500/40'
          : disabled
            ? 'border border-dashed border-navy-500/50 text-navy-400 cursor-not-allowed'
            : 'border border-navy-500/40 text-navy-300 hover:text-white hover:border-teal-500/30'
      }`}
    >
      {children}
      {disabled && <span className="text-[9px] uppercase tracking-wider text-navy-500">n/a</span>}
    </button>
  );
}

function FilterChip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 h-6 rounded-md text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap ${
        active
          ? 'bg-teal-500/15 text-teal-300 border border-teal-500/50'
          : 'border border-navy-500/40 text-navy-300 hover:text-white hover:border-teal-500/40'
      }`}
    >
      {children}
    </button>
  );
}

function PriceChip({
  value, onChange, currency,
}: {
  value:    number | null;
  onChange: (v: number | null) => void;
  currency: string;
}) {
  // Thresholds covered: $100, $200, $400 max. Reasonable buckets for the
  // wholesale rates LiteAPI typically returns ($60–$600/night).
  const opts: Array<{ label: string; v: number | null }> = [
    { label: 'Any price',  v: null },
    { label: 'Under $150', v: 150 },
    { label: 'Under $300', v: 300 },
    { label: 'Under $500', v: 500 },
  ];
  return (
    <div className="flex items-center gap-1">
      {opts.map(o => (
        <FilterChip
          key={String(o.v)}
          active={value === o.v}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </FilterChip>
      ))}
      {value !== null && (
        <span className="text-[10px] text-navy-400 font-mono">{currency}</span>
      )}
    </div>
  );
}

// ─── Mappers: NormalizedX → CanvasXSelection ─────────────────────────────────

function toCanvasFlight(
  f: NormalizedFlight,
  pricedFor?: { adults: number; children: number; childAges?: number[] },
): CanvasFlightSelection {
  return {
    offerId:       f.id,
    origin:        f.origin,
    destination:   f.destination,
    airline:       f.airline,
    flightNumber:  f.legs?.[0]?.segments?.[0]?.flightNumber || '',
    departureTime: f.departure,
    arrivalTime:   f.arrival,
    duration:      f.duration,
    stops:         f.stops,
    stopAirports:  f.stopAirports,
    cabinClass:    f.cabinClass || 'economy',
    priceCents:    Math.round(f.price * 100),
    currency:      f.currency || 'USD',
    flexibility:   f.fareVariants?.[0]?.flexibilityLabel,
    flexibilitySummary: f.flexibilitySummary,
    refundable:    f.refundable,
    baggage:       f.baggage,
    segments:      f.legs?.[0]?.segments,
    legs:          f.legs,
    returnSegments: f.returnSegments,
    returnDeparture: f.returnDeparture,
    returnArrival:   f.returnArrival,
    returnDuration:  f.returnDuration,
    returnStops:     f.returnStops,
    returnStopAirports: f.returnStopAirports,
    pricedFor,
  };
}

function toCanvasHotel(
  h: NormalizedHotel,
  fallbackCity: string,
  pricedFor?: { adults: number; children: number; childAges?: number[] },
): CanvasHotelSelection {
  return {
    rateId:         h.bookingToken || h.id,
    hotelId:        h.id,
    name:           h.name,
    city:           h.city || fallbackCity,
    starRating:     h.stars,
    reviewScore:    h.rating,
    perNightCents:  Math.round(h.pricePerNight * 100),
    totalCents:     Math.round(h.totalPrice * 100),
    currency:       h.currency || 'USD',
    cancellationPolicy: h.cancellation,
    image:          h.image,
    pricedFor,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseDur(s: string): number {
  // Parse "7h 35m" → minutes
  const h = /([0-9]+)h/.exec(s);
  const m = /([0-9]+)m/.exec(s);
  return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
}

function formatFlightClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function layoverDuration(arrivalIso: string, nextDepartureIso: string): string | null {
  const arrive = new Date(arrivalIso).getTime();
  const depart = new Date(nextDepartureIso).getTime();
  if (!Number.isFinite(arrive) || !Number.isFinite(depart) || depart <= arrive) return null;
  const mins = Math.round((depart - arrive) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

// Live IATA resolution via /api/canvas/resolve-airport (Duffel /places/
// suggestions under the hood). The local airport-coords table acts as an
// instant cache for the most-typed cities; anything else round-trips to
// Duffel via our endpoint. No more hardcoded list of cities the user has
// to memorise — every airport Duffel knows resolves.
async function liveResolveIata(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 3-letter shortcut — accept verbatim
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();

  // Fast path: local airport-coords map
  const local = resolveIata(trimmed);
  if (local) return local;

  // Live: ask Duffel
  try {
    const res = await fetch(`/api/canvas/resolve-airport?q=${encodeURIComponent(trimmed)}`);
    if (!res.ok) return null;
    const data = await res.json() as { best?: { iata?: string } };
    return data.best?.iata ?? null;
  } catch {
    return null;
  }
}

// ─── Hotel thumbnail with deterministic gradient fallback ───────────────────
// LiteAPI doesn't always return a main_photo for every hotel. Rather than
// showing a generic icon, we render a stylized panel with the hotel's first
// 1-2 letters on a deterministic teal/navy gradient. Better than empty.

function HotelThumb({ hotel, size }: { hotel: NormalizedHotel; size: number }) {
  // Use a real <img> so we can detect load failures (LiteAPI sometimes returns
  // dead photo URLs or hot-link-protected images) and fall back to the
  // gradient initials instead of leaving a blank navy square.
  const [errored, setErrored] = useState(false);
  const px = size * 4;

  if (hotel.image && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={hotel.image}
        alt={hotel.name}
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
        className="rounded-md object-cover bg-navy-800"
        style={{ height: `${px}px`, width: `${px}px` }}
      />
    );
  }

  // No photo (or photo failed to load) — render initials + colored gradient
  const hash = (() => {
    let h = 0;
    for (let i = 0; i < hotel.name.length; i++) h = ((h << 5) - h + hotel.name.charCodeAt(i)) | 0;
    return Math.abs(h);
  })();
  const palettes = [
    'from-teal-600 to-navy-800',
    'from-amber-600 to-navy-800',
    'from-purple-700 to-navy-800',
    'from-rose-700 to-navy-800',
    'from-blue-700 to-navy-800',
    'from-emerald-700 to-navy-800',
  ];
  const palette = palettes[hash % palettes.length];
  const initials = hotel.name
    .split(/\s+/)
    .filter(w => w && /[A-Za-z0-9]/.test(w[0]))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');

  return (
    <div
      className={`rounded-md bg-gradient-to-br ${palette} flex items-center justify-center font-semibold text-white`}
      style={{ height: `${size * 4}px`, width: `${size * 4}px`, fontSize: `${size * 0.9}px`, fontFamily: 'var(--font-spectral), Georgia, serif' }}
      role="img"
      aria-label={hotel.name}
    >
      {initials || <Hotel className="w-5 h-5 opacity-80" />}
    </div>
  );
}

// ─── Hotel detail view ───────────────────────────────────────────────────────
// Loads /api/hotel-detail (LiteAPI's /data/hotel) and renders a full-bleed
// detail panel inside the SlotPicker sheet. Photos carousel, description,
// amenities, address, sticky "Pick this hotel" CTA at the bottom.

interface HotelDetailImage {
  url:         string;
  caption?:    string;
  // /api/hotel-detail returns `isDefault`; legacy direct LiteAPI shape used
  // `defaultImage`. Accept both — the picker treats them as the same flag.
  isDefault?:    boolean;
  defaultImage?: boolean;
}

interface HotelDetail {
  id:           string;
  name:         string;
  starRating?:  number;
  hotelDescription?: string;
  // /api/hotel-detail returns photos under `images`; the legacy direct-LiteAPI
  // shape used `hotelImages`. Both are accepted so either source works.
  images?:      HotelDetailImage[];
  hotelImages?: HotelDetailImage[];
  hotelFacilities?: string[];
  amenities?: string[];                              // /api/hotel-detail aliases hotelFacilities here
  description?: string;                              // /api/hotel-detail aliases hotelDescription here
  location?: { address?: string; city?: string; countryCode?: string };
  // /api/hotel-detail also surfaces these at the top level
  countryCode?: string;
  coordinates?: { lat: number; lon: number };
  checkinCheckoutTimes?: { checkin?: string; checkout?: string };
  contact?: { phone?: string; email?: string; website?: string };
}

// Map LiteAPI's two-letter board code to a user-friendly label + icon hint
const BOARD_TYPES: Record<string, { label: string; emoji: string }> = {
  RO: { label: 'Room only',         emoji: '🛏' },
  BB: { label: 'Breakfast included', emoji: '🥐' },
  HB: { label: 'Half board',        emoji: '🍽' },
  FB: { label: 'Full board',        emoji: '🍽' },
  AI: { label: 'All-inclusive',     emoji: '🌟' },
};

// Country-aware narratives for the most common tax / fee labels LiteAPI surfaces.
// Returns a short explainer for the user, or null when we don't know the label.
//
// LiteAPI's `description` field is whatever the supplier pushed up — anything from
// crisp ("Quebec lodging tax") to vague ("government tax", "EXTERNAL TAX"). We
// match by lowercased substring so capitalisation differences don't matter.
function explainTaxLine(rawLabel: string, countryCode?: string): string | null {
  const lbl = (rawLabel || '').toLowerCase();
  const cc  = (countryCode || '').toUpperCase();

  // ── Country-bundle catch-alls ─────────────────────────────────────────────
  if (/government tax|govt tax/.test(lbl)) {
    if (cc === 'CA') return 'Bundles federal GST (5%), provincial sales tax (e.g. QST 9.975% in Quebec, HST 13–15% in Atlantic provinces), and any provincial lodging tax. Remitted by the hotel to government authorities.';
    if (cc === 'US') return 'Bundles state sales tax + city / county hotel occupancy tax. Rate varies by jurisdiction (typically 10–18% combined).';
    if (cc === 'GB' || cc === 'UK') return 'UK VAT — currently 20% on hotel accommodation, included in the displayed total.';
    if (cc === 'FR' || cc === 'IT' || cc === 'ES' || cc === 'DE' || cc === 'NL' || cc === 'BE' || cc === 'PT' || cc === 'AT' || cc === 'GR' || cc === 'IE')
      return 'EU VAT (typically 10% on hotel accommodation) + any city tourism tax. Rates vary by country.';
    if (cc === 'AE') return 'UAE 5% VAT + tourism dirham (per-room per-night fee) + municipality fee.';
    if (cc === 'AU') return 'Australian GST — 10% on hotel accommodation.';
    if (cc === 'NZ') return 'NZ GST — 15% on hotel accommodation.';
    if (cc === 'SG') return 'Singapore 8% GST + 1% tourism tax.';
    if (cc === 'JP') return 'Japan 10% consumption tax + per-night accommodation tax in major cities.';
    if (cc === 'IN') return 'India GST — 12% (rooms ≤ ₹7,500/night) or 18% (above), plus state-specific luxury tax in some regions.';
    return 'Government-mandated taxes and levies remitted by the hotel. Bundle of national, regional, and city charges that vary by jurisdiction.';
  }
  // ── Specific named taxes ──────────────────────────────────────────────────
  if (/lodging tax|tsh|taxe spécifique|accommodation tax/.test(lbl))
    return 'Lodging / accommodation tax — paid to the regional tourism authority. In Quebec it\'s the TSH at 3.5% of base rate.';
  if (/occupancy tax|hotel tax|transient/.test(lbl))
    return 'City / county hotel-occupancy tax. US cities typically 10–18%; charged on accommodation.';
  if (/city tax|taxe de séjour|kurtaxe|tourist tax|tourism tax|tourism levy|destination|marketing/.test(lbl))
    return 'Per-person per-night tourism levy paid to the local tourism board (e.g. Paris, Berlin, Rome). Often a small flat amount.';
  if (/^vat|^value-added|value added|tva|iva|moms|btw|mva/.test(lbl))
    return 'Value-added tax. Most EU countries charge a reduced VAT rate (~10%) on hotels; UK is 20%; UAE is 5%.';
  if (/gst\b/.test(lbl))
    return 'Goods & services tax. Canada: 5%. Australia / NZ: 10%/15%. Singapore: 8%. India: 12% or 18% depending on rate band.';
  if (/qst\b/.test(lbl)) return 'Quebec sales tax — 9.975%, applied on top of GST.';
  if (/hst\b/.test(lbl)) return 'Harmonised sales tax — federal + provincial combined (Atlantic Canada, ON: 13–15%).';
  if (/pst\b/.test(lbl)) return 'Provincial sales tax — varies by Canadian province (BC 8%, SK 6%, MB 7%).';
  if (/resort fee|destination fee|amenity fee|facility fee/.test(lbl))
    return 'Mandatory hotel resort / amenity fee — covers Wi-Fi, gym, pool, and similar. Not a tax; paid directly to the hotel.';
  if (/service (fee|charge)|servicio/.test(lbl))
    return 'Hotel service charge / gratuity — distributed to staff. Not a tax.';
  if (/external tax|mandatory tax|mandatory fee|mandatory|other tax|miscellaneous/.test(lbl))
    return 'Generic line the hotel\'s system pushed up without a clearer label. Likely a regional or property-specific charge bundled here. Ask the hotel directly if a specific breakdown matters for expensing.';

  return null;
}

const AMENITY_ICONS: Array<{ kw: string[]; icon: React.ComponentType<{ className?: string }> }> = [
  { kw: ['wifi', 'internet'],          icon: Wifi },
  { kw: ['parking', 'garage'],         icon: Car },
  { kw: ['restaurant', 'dining'],      icon: UtensilsCrossed },
  { kw: ['pool', 'swimming'],          icon: Waves },
  { kw: ['gym', 'fitness'],            icon: Dumbbell },
  { kw: ['air condition', 'a/c'],      icon: Wind },
  { kw: ['breakfast', 'coffee'],       icon: Coffee },
];

function iconForAmenity(name: string): React.ComponentType<{ className?: string }> | null {
  const n = name.toLowerCase();
  for (const a of AMENITY_ICONS) if (a.kw.some(k => n.includes(k))) return a.icon;
  return null;
}

function HotelDetailView({
  hotel, nights, onBack, onPick,
}: {
  hotel:   NormalizedHotel;
  nights:  number;
  onBack:  () => void;
  onPick:  () => void;
}) {
  const [detail, setDetail]   = useState<HotelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setPhotoIdx(0);
    (async () => {
      try {
        const res = await fetch(`/api/hotel-detail?hotelId=${encodeURIComponent(hotel.id)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setDetail(data ?? null);
        }
      } catch { /* keep fallback */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [hotel.id]);

  // Photo gallery — accept BOTH /api/hotel-detail's `images` field AND the
  // legacy direct-LiteAPI `hotelImages` field so a wire-up regression on
  // either side doesn't silently collapse to a single thumbnail.
  const rawPhotos = useMemo(() => {
    const merged = [...(detail?.images ?? []), ...(detail?.hotelImages ?? [])];
    return merged
      .filter((p): p is HotelDetailImage => !!p && typeof p.url === 'string' && p.url.length > 0)
      .map(p => ({
        url:       p.url,
        caption:   p.caption,
        isDefault: p.isDefault ?? p.defaultImage,
      }));
  }, [detail]);

  // Categorized photos — buckets by caption keyword (room / exterior /
  // lobby / pool / amenity / etc.) so each room card can show a distinct
  // photo and the gallery can group photos by type.
  const categorized = useMemo(() => categorizePhotos(rawPhotos), [rawPhotos]);
  const photoBuckets = useMemo(() => bucketPhotos(categorized), [categorized]);

  // Flat URL list used by the carousel up top + as the fallback gallery.
  const photos = useMemo(() => {
    if (categorized.length > 0) return categorized.map(p => p.url);
    return hotel.image ? [hotel.image] : [];
  }, [categorized, hotel.image]);

  // Active gallery filter — null = show all categories. Filters affect only
  // the carousel index range, not the room cards (which always sample from
  // the room bucket).
  const [galleryFilter, setGalleryFilter] = useState<PhotoCategory | null>(null);
  const visiblePhotos = useMemo(() => {
    if (!galleryFilter) return photos;
    const filtered = categorized.filter(p => p.category === galleryFilter).map(p => p.url);
    return filtered.length > 0 ? filtered : photos;
  }, [galleryFilter, categorized, photos]);

  // Strip raw HTML to plain text for the description. /api/hotel-detail
  // returns it under `description`; the legacy direct-LiteAPI shape used
  // `hotelDescription`. Accept either.
  const descPlain = useMemo(() => {
    const html = detail?.description ?? detail?.hotelDescription ?? '';
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }, [detail]);
  const [descExpanded, setDescExpanded] = useState(false);

  // Amenities — /api/hotel-detail returns them under `amenities`; the older
  // direct-LiteAPI path returns `hotelFacilities`. Accept either.
  const amenities = detail?.amenities ?? detail?.hotelFacilities ?? [];

  // Static Mapbox image of the hotel pin — costs nothing extra (we already
  // have NEXT_PUBLIC_MAPBOX_TOKEN) and avoids loading the full Mapbox GL JS.
  const mapboxStaticUrl = useMemo(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !detail?.coordinates) return null;
    const { lat, lon } = detail.coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    // Pin marker, dark style, 600×220, zoom 14
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+33c093(${lon},${lat})/${lon},${lat},14,0/600x220@2x?access_token=${token}`;
  }, [detail?.coordinates]);

  const board = hotel.boardType ? BOARD_TYPES[hotel.boardType] : undefined;

  // ── Room / rate options ──────────────────────────────────────────────────
  // Flatten allRoomTypes into a single list of pickable rates so the user
  // can compare "Deluxe King – Bed & Breakfast – refundable" alongside
  // "Standard Queen – Room only – non-refundable" without nested clicks.
  // Each entry carries the bookingToken needed to commit that exact rate.
  interface RateOption {
    key:            string;
    bookingToken:   string;
    roomName:       string;
    rateName?:      string;
    boardType?:     string;
    boardName?:     string;
    refundable?:    boolean;
    maxOccupancy?:  number;
    totalPrice:     number;       // total for the whole stay
    pricePerNight:  number;       // total / nights, rounded
    currency:       string;
  }
  const rateOptions: RateOption[] = useMemo(() => {
    const out: RateOption[] = [];
    for (const rt of hotel.allRoomTypes ?? []) {
      for (const r of rt.rates ?? []) {
        if (!r.rateId || typeof r.price !== 'number') continue;
        out.push({
          key:           `${rt.offerId ?? ''}::${r.rateId}`,
          bookingToken:  `liteapi_${rt.offerId}::${r.rateId}`,
          roomName:      rt.name ?? 'Room',
          rateName:      r.name,
          boardType:     r.boardType,
          boardName:     r.boardName,
          refundable:    r.refundable,
          maxOccupancy:  rt.maxOccupancy,
          totalPrice:    r.price,
          pricePerNight: Math.round((r.price / Math.max(1, nights)) * 100) / 100,
          currency:      r.currency ?? hotel.currency ?? 'USD',
        });
      }
    }
    // Cheapest first
    return out.sort((a, b) => a.totalPrice - b.totalPrice);
  }, [hotel.allRoomTypes, hotel.currency, nights]);

  // Find the rate that matches the hotel.bookingToken (the one initially shown
  // in search results) so we open with the user's current selection highlighted.
  const initialKey = useMemo(() => {
    const match = rateOptions.find(r => r.bookingToken === hotel.bookingToken);
    return match?.key ?? rateOptions[0]?.key ?? null;
  }, [rateOptions, hotel.bookingToken]);

  const [selectedRateKey, setSelectedRateKey] = useState<string | null>(initialKey);
  // Sync selection when the hotel changes (e.g. user navigates between hotels)
  useEffect(() => { setSelectedRateKey(initialKey); }, [initialKey]);

  const selectedRate = rateOptions.find(r => r.key === selectedRateKey);
  // Effective pricing: prefer the user's chosen rate; fall back to the
  // hotel-level price (which is already the cheapest rate's price).
  const effectivePerNight = selectedRate?.pricePerNight ?? hotel.pricePerNight;
  const effectiveTotal    = selectedRate?.totalPrice    ?? hotel.totalPrice;
  const effectiveCurrency = selectedRate?.currency      ?? hotel.currency;
  // Tell the user when "$X/night × N" doesn't equal total — happens when
  // nightly rates vary (weekend uplifts, dynamic pricing). Avoids the
  // "$699 × 7 = $4,893 but it shows $4,892" confusion.
  const totalFromAvg     = Math.round(effectivePerNight * nights * 100) / 100;
  const ratesVaryByNight = Math.abs(totalFromAvg - effectiveTotal) >= 1;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky back bar */}
      <div className="flex items-center gap-2 px-4 h-12 border-b border-navy-500/30 bg-navy-950/80 backdrop-blur-sm flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 h-8 rounded-md text-xs text-navy-200 hover:text-white hover:bg-navy-800/60"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to results
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Photos */}
        <div className="relative w-full bg-navy-900/40" style={{ aspectRatio: '16/10' }}>
          {visiblePhotos.length > 0 ? (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center transition-opacity"
                style={{ backgroundImage: `url('${visiblePhotos[Math.min(photoIdx, visiblePhotos.length - 1)]}')` }}
                role="img"
                aria-label={hotel.name}
              />
              {visiblePhotos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPhotoIdx((photoIdx - 1 + visiblePhotos.length) % visiblePhotos.length)}
                    className="absolute top-1/2 -translate-y-1/2 left-3 h-9 w-9 rounded-full bg-navy-950/70 hover:bg-navy-950/95 text-white flex items-center justify-center"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoIdx((photoIdx + 1) % visiblePhotos.length)}
                    className="absolute top-1/2 -translate-y-1/2 right-3 h-9 w-9 rounded-full bg-navy-950/70 hover:bg-navy-950/95 text-white flex items-center justify-center"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 h-6 rounded-full bg-navy-950/85 text-white text-xs font-mono flex items-center">
                    {Math.min(photoIdx, visiblePhotos.length - 1) + 1} / {visiblePhotos.length}
                  </div>
                </>
              )}
              {/* Category filter chips — only render when LiteAPI returned
                  photos with captions across more than one category. Lets
                  the user jump from "Rooms" to "Pool" to "Dining" without
                  scrolling through 30 thumbnails. */}
              {photoBuckets.length > 1 && (
                <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-1.5" data-testid="photo-category-chips">
                  <button
                    type="button"
                    onClick={() => { setGalleryFilter(null); setPhotoIdx(0); }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider ${
                      galleryFilter === null
                        ? 'bg-teal-500/90 text-white'
                        : 'bg-navy-950/80 text-navy-200 hover:text-white'
                    }`}
                  >
                    All · {photos.length}
                  </button>
                  {photoBuckets.map(b => (
                    <button
                      key={b.category}
                      type="button"
                      onClick={() => { setGalleryFilter(b.category); setPhotoIdx(0); }}
                      data-testid={`photo-category-${b.category}`}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider ${
                        galleryFilter === b.category
                          ? 'bg-teal-500/90 text-white'
                          : 'bg-navy-950/80 text-navy-200 hover:text-white'
                      }`}
                    >
                      {b.label} · {b.photos.length}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <HotelThumb hotel={hotel} size={28} />
            </div>
          )}
          {loading && (
            <div className="absolute top-3 left-3 px-2 h-6 rounded-md bg-navy-950/80 text-navy-200 text-[11px] font-mono flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading details
            </div>
          )}
        </div>

        {/* Header info */}
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-2xl text-white font-medium" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            {hotel.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-navy-200">
            {hotel.stars > 0 && <span className="text-amber-400">{'★'.repeat(Math.round(hotel.stars))}</span>}
            {typeof hotel.googleRating === 'number' && hotel.googleRatingCount && hotel.googleRatingCount > 0 ? (
              <span className="tabular-nums inline-flex items-center gap-1" title="Google review score">
                <span className="text-amber-400">★</span>
                {hotel.googleRating.toFixed(1)}
                <span className="text-navy-300">({hotel.googleRatingCount.toLocaleString()} Google reviews)</span>
              </span>
            ) : hotel.rating > 0 ? (
              <span className="tabular-nums">{hotel.rating.toFixed(1)} <span className="text-navy-400">/ 10 guest score</span></span>
            ) : null}
            {hotel.reviewCount !== undefined && hotel.reviewCount > 0 && !hotel.googleRatingCount && (
              <span className="text-navy-300 tabular-nums">{hotel.reviewCount.toLocaleString()} reviews</span>
            )}
            {board && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-300 text-[11px] font-medium">
                <span aria-hidden>{board.emoji}</span>
                {board.label}
              </span>
            )}
            {hotel.refundableTag === 'RFN' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 text-[11px] font-medium">
                Free cancellation
              </span>
            )}
            {hotel.maxOccupancy !== undefined && hotel.maxOccupancy > 0 && (
              <span className="text-navy-300">Sleeps up to {hotel.maxOccupancy}</span>
            )}
          </div>
          {(detail?.location?.address || hotel.location || hotel.address) && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-navy-300">
              <MapPin className="w-3.5 h-3.5 text-navy-400 mt-0.5 flex-shrink-0" />
              <span>{detail?.location?.address || hotel.location || hotel.address}</span>
            </div>
          )}
          {detail?.checkinCheckoutTimes && (
            <div className="mt-2 text-xs text-navy-300 font-mono">
              {detail.checkinCheckoutTimes.checkin && <>Check-in {detail.checkinCheckoutTimes.checkin}</>}
              {detail.checkinCheckoutTimes.checkin && detail.checkinCheckoutTimes.checkout && <span className="mx-1.5">·</span>}
              {detail.checkinCheckoutTimes.checkout && <>Check-out {detail.checkinCheckoutTimes.checkout}</>}
            </div>
          )}
        </div>

        {/* Description — expandable */}
        {descPlain && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">About</p>
            <p className="text-sm text-navy-100 leading-relaxed">
              {descExpanded || descPlain.length <= 380
                ? descPlain
                : descPlain.slice(0, 380).trim() + '…'}
            </p>
            {descPlain.length > 380 && (
              <button
                type="button"
                onClick={() => setDescExpanded(v => !v)}
                className="mt-1.5 text-[11px] font-mono text-teal-400 hover:text-teal-300"
              >
                {descExpanded ? '[ show less ]' : '[ read more ]'}
              </button>
            )}
          </div>
        )}

        {/* Amenities */}
        {amenities.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Amenities</p>
            <div className="grid grid-cols-2 gap-2">
              {amenities.slice(0, 12).map((a) => {
                const Icon = iconForAmenity(a);
                return (
                  <div key={a} className="flex items-center gap-2 text-xs text-navy-100 px-2 py-1.5 rounded-md bg-navy-900/40">
                    {Icon ? <Icon className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" /> : <span className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span className="truncate">{a}</span>
                  </div>
                );
              })}
            </div>
            {amenities.length > 12 && (
              <p className="mt-2 text-[11px] text-navy-400">+ {amenities.length - 12} more</p>
            )}
          </div>
        )}

        {/* Mini-map — Mapbox static image, no JS bundle cost */}
        {mapboxStaticUrl && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Location</p>
            <div className="rounded-lg overflow-hidden hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mapboxStaticUrl}
                alt={`Map showing ${hotel.name} location`}
                width={600}
                height={220}
                loading="lazy"
                className="w-full h-auto block"
              />
            </div>
            {detail?.location?.address && (
              <p className="mt-2 text-xs text-navy-300">{detail.location.address}</p>
            )}
          </div>
        )}

        {/* Rooms & rates — every room/rate combo LiteAPI returned, cheapest
            first. Tap a card to switch the picked rate (updates price + the
            bookingToken used at checkout). LiteAPI doesn't return per-room
            photos, so we cycle through the hotel's gallery for visual variety. */}
        {rateOptions.length > 1 && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">
              Rooms · {rateOptions.length} options
            </p>
            <ul className="space-y-2">
              {rateOptions.map((opt, idx) => {
                const selected = opt.key === selectedRateKey;
                // Each room card prefers a ROOM-tagged photo (pickRoomPhoto
                // returns a different one per index when the bucket has > 1
                // photo). Falls back to non-exterior photos, then the full
                // gallery. Only collapses to a duplicate when LiteAPI returned
                // a single photo for the whole hotel.
                const photo = pickRoomPhoto(categorized, idx) ?? hotel.image ?? null;
                const optBoard = opt.boardType ? BOARD_TYPES[opt.boardType] : undefined;
                return (
                  <li key={opt.key} data-testid="room-rate-card" data-room-photo={photo ?? ''}>
                    <button
                      type="button"
                      onClick={() => setSelectedRateKey(opt.key)}
                      aria-pressed={selected}
                      className={`w-full text-left rounded-lg p-3 transition flex gap-3 ${
                        selected
                          ? 'bg-teal-500/10 ring-2 ring-teal-500/50'
                          : 'bg-navy-900/40 hairline-hover ring-1 ring-navy-500/30 hover:ring-teal-500/40'
                      }`}
                    >
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photo}
                          alt={opt.roomName}
                          width={72}
                          height={56}
                          loading="lazy"
                          className="flex-shrink-0 rounded-md object-cover bg-navy-800"
                          style={{ width: 72, height: 56 }}
                        />
                      ) : (
                        <div className="flex-shrink-0 rounded-md bg-gradient-to-br from-teal-700 to-navy-800" style={{ width: 72, height: 56 }} aria-hidden />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-navy-50 truncate">{opt.roomName}</p>
                        {opt.rateName && (
                          <p className="text-[11px] text-navy-300 truncate">{opt.rateName}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {optBoard && (
                            <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300">
                              {optBoard.emoji} {optBoard.label}
                            </span>
                          )}
                          {opt.refundable && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">Free cancellation</span>
                          )}
                          {opt.maxOccupancy !== undefined && opt.maxOccupancy > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-navy-700/60 text-navy-200">Sleeps {opt.maxOccupancy}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-semibold text-white tabular-nums">${opt.pricePerNight.toFixed(0)}<span className="text-[10px] text-navy-300 font-normal">/n</span></p>
                        <p className="text-[10px] text-navy-300 tabular-nums">${opt.totalPrice.toFixed(0)} total</p>
                        {selected && (
                          <p className="mt-1 text-[10px] uppercase tracking-wider text-teal-400 font-mono">selected</p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Full cancellation policy — array of dated rules from LiteAPI */}
        {hotel.cancelPolicies && hotel.cancelPolicies.length > 0 ? (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Cancellation policy</p>
            <ul className="space-y-1.5 text-xs text-navy-200">
              {hotel.cancelPolicies.map((p: { cancelTime?: string; amount?: number; description?: string; type?: string }, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-teal-400 mt-0.5">•</span>
                  <span>
                    {p.cancelTime && (
                      <span className="text-navy-300">
                        Until {new Date(p.cancelTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' — '}
                      </span>
                    )}
                    {p.amount !== undefined && p.amount > 0
                      ? `Cancellation fee ${p.amount} ${hotel.currency || 'USD'}`
                      : (p.description || 'Free cancellation')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : hotel.cancellation && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Cancellation</p>
            <p className="text-xs text-navy-200">
              {hotel.cancellation.replace(/<[^>]+>/g, '').slice(0, 240)}
            </p>
          </div>
        )}

        {/* Taxes & fees — roll-up summary on top, expandable per-line below.
            Each line item gets a (?) toggle revealing a country-aware
            explainer of what "government tax", "VAT", "occupancy tax" etc.
            actually cover. Removes the "what is this $601 charge?" mystery. */}
        {hotel.taxesAndFees && hotel.taxesAndFees.length > 0 && (
          <TaxesAndFees
            taxesAndFees={hotel.taxesAndFees}
            currency={hotel.currency || 'USD'}
            totalPrice={effectiveTotal}
            countryCode={detail?.countryCode || detail?.location?.countryCode}
          />
        )}

        {/* Contact strip — phone / website */}
        {(detail?.contact?.phone || detail?.contact?.website) && (
          <div className="px-5 pb-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono mb-2">Contact</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-navy-200">
              {detail.contact.phone && (
                <a href={`tel:${detail.contact.phone}`} className="hover:text-white">📞 {detail.contact.phone}</a>
              )}
              {detail.contact.website && (
                <a href={detail.contact.website} target="_blank" rel="noopener noreferrer" className="hover:text-white truncate max-w-[16rem]">🌐 {detail.contact.website.replace(/^https?:\/\//, '')}</a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sticky pick CTA — uses the rate the user selected in the Rooms list */}
      <div className="border-t border-navy-500/30 px-5 py-3 bg-navy-950/95 backdrop-blur-sm flex items-center justify-between gap-3 flex-shrink-0">
        <div>
          <p className="text-xl font-semibold text-white tabular-nums">
            ${effectivePerNight.toFixed(0)}
            <span className="text-sm text-navy-300 font-normal">{ratesVaryByNight ? ' avg / night' : ' / night'}</span>
          </p>
          <p className="text-[11px] text-navy-300 tabular-nums">
            ${effectiveTotal.toFixed(0)} {effectiveCurrency} total · {nights} night{nights === 1 ? '' : 's'}
          </p>
          {ratesVaryByNight && (
            <p className="text-[10px] text-navy-400 leading-snug">
              Nightly rate varies; total is the source of truth.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onPickWithRate(selectedRate)}
          className="h-10 px-5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium"
        >
          Pick this hotel
        </button>
      </div>
    </div>
  );

  // Wrap onPick so that if the user switched rates inside the detail view,
  // the parent receives a hotel object with the chosen bookingToken/price.
  function onPickWithRate(rate: RateOption | undefined) {
    if (!rate) { onPick(); return; }
    if (rate.bookingToken === hotel.bookingToken && rate.totalPrice === hotel.totalPrice) {
      onPick();    // unchanged
      return;
    }
    // Mutate the hotel object the parent will read inside its onPick callback.
    // The mappers (toCanvasHotel) read pricePerNight/totalPrice/bookingToken
    // off the hotel reference at call time, so updating these is enough.
    hotel.bookingToken  = rate.bookingToken;
    hotel.pricePerNight = rate.pricePerNight;
    hotel.totalPrice    = rate.totalPrice;
    hotel.currency      = rate.currency;
    if (rate.boardType) hotel.boardType = rate.boardType;
    if (rate.boardName) hotel.boardName = rate.boardName;
    hotel.refundableTag = rate.refundable ? 'RFN' : (hotel.refundableTag ?? undefined);
    onPick();
  }
}

// Re-export the mappers so the chat fallback can use the same conversion.
// Suppress unused warning for Sparkles import in case future versions add an
// AI-suggested option pill.
void Sparkles;

// Compact review-count formatter — "1,200" → "1.2k", "12,500" → "12k"
function formatRatingCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}
