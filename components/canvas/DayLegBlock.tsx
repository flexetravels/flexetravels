'use client';

// DayLegBlock — renders one leg of the trip canvas (Hybrid direction).
// Linear/Notion sleek bones + a 16:9 hero photo + horizontal photo strip.
// Photos come live from /api/canvas/photos (Unsplash search) so any
// destination the user types renders a real, current photo of itself —
// no stale hardcoded ID tables.
//
// Has flight slot + hotel slot. Empty slots open the SlotPicker.

import { useEffect, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plane, Hotel, MoreHorizontal, X, GripVertical, ChevronUp, ChevronDown,
  CalendarDays,
} from 'lucide-react';
import { type CanvasLeg, type CanvasState } from '@/lib/canvas/types';
import { SlotPicker } from './SlotPicker';
import { type CanvasOp } from '@/lib/canvas/state';
import { DestinationHero } from './DestinationHero';
import { PhotoStrip } from './PhotoStrip';
import { ItineraryPanel } from './ItineraryPanel';
import { getDestinationMedia, type DestinationMedia } from '@/lib/canvas/destination-media';

interface Props {
  leg:        CanvasLeg;
  index:      number;
  state:      CanvasState;
  dispatch:   (op: CanvasOp) => void;
  tripId:      string;
  sessionId:   string;
  readOnly?:  boolean;            // shared / view-only mode — hides edit controls
  // Drag-reorder wiring (CanvasPage owns the DndContext)
  isDragGhost?: boolean;          // true when this card is the active drag source
  onMoveUp?:    () => void;       // touch / keyboard fallback
  onMoveDown?:  () => void;
  canMoveUp?:   boolean;
  canMoveDown?: boolean;
}

export function DayLegBlock({
  leg, index, state, dispatch, tripId, sessionId,
  readOnly,
  isDragGhost,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}: Props) {
  // ── @dnd-kit/sortable wires the whole card up as the drag target. The
  // PointerSensor activation distance (set on the parent DndContext) means
  // ordinary clicks on buttons inside the card still work — drag only kicks
  // in once the pointer actually moves > 6px.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: leg.id, disabled: readOnly });

  const style: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition,
    // Hide the in-list source while a DragOverlay shows the floating preview
    opacity:    isDragGhost ? 0 : 1,
  };
  const [pickerOpen, setPickerOpen] = useState<'flight' | 'hotel' | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);

  // Start with the themed-fallback set so the leg paints instantly; replace
  // with live Unsplash photos once /api/canvas/photos resolves. We re-fetch
  // when the city changes (e.g. AI swaps the leg's destination).
  const [media, setMedia] = useState<DestinationMedia>(() => getDestinationMedia(leg.city, leg.iata));

  useEffect(() => {
    const cityKey = (leg.city || '').trim();
    // Reset to the themed fallback whenever the city changes so we don't
    // briefly show the previous destination's photos under the new label.
    setMedia(getDestinationMedia(leg.city, leg.iata));
    if (!cityKey) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/canvas/photos?city=${encodeURIComponent(cityKey)}&v=${encodeURIComponent(cityKey.toLowerCase())}`);
        if (!res.ok) return;            // 404 → keep the themed fallback
        const data = await res.json() as { hero?: string; gallery?: string[] };
        if (cancelled || !data?.hero) return;
        setMedia(prev => ({ ...prev, hero: data.hero!, gallery: data.gallery ?? prev.gallery }));
      } catch {
        // network blip — keep the themed fallback silently
      }
    })();
    return () => { cancelled = true; };
  }, [leg.city, leg.iata]);

  const nights = nightCount(leg.startDate, leg.endDate);
  // While being dragged in-list, dim the source so the DragOverlay reads as
  // the "real" card. dnd-kit handles the smooth slide of the other cards.
  const dragCls = isDragging
    ? 'ring-2 ring-teal-500/60 shadow-2xl shadow-teal-500/15'
    : '';

  // Pointer/touch listeners go on the whole article so the entire card is
  // grabbable. We deliberately DO NOT spread `attributes` here — those add
  // role="button" + tabIndex, which would make the article masquerade as a
  // button in the a11y tree (and confuse `getByRole` selectors that target
  // the inner "Pick a flight" / "Pick a hotel" buttons). The dedicated grip
  // handle below owns the a11y story via `setActivatorNodeRef` + attributes.
  const dragListeners = readOnly ? {} : listeners;

  const photoStatus = useMemo(() => {
    const fallback = getDestinationMedia(leg.city, leg.iata);
    const live = Boolean(media.hero && media.hero !== fallback.hero);
    return live ? 'Live destination photo' : 'Finding live destination photo';
  }, [media.hero, leg.city, leg.iata]);

  return (
    <article
      ref={readOnly ? undefined : setNodeRef}
      style={readOnly ? undefined : style}
      className={`w-full max-w-full rounded-lg sm:rounded-xl bg-navy-900/40 overflow-hidden hairline transition-shadow ${!readOnly ? 'sm:cursor-grab active:cursor-grabbing' : ''} ${dragCls}`}
      {...dragListeners}
    >
      {/* Hero — destination photo, lazy-loaded once the leg scrolls into view */}
      <div className="relative h-48 sm:h-56 md:h-64">
        <DestinationHero
          src={media.hero}
          fallbackSrc={media.gallery[0]}
          alt={leg.city}
          className="absolute inset-0"
          overlay={
            <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 pointer-events-none sm:bottom-5 sm:left-6 sm:right-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="italic text-navy-100 text-xs sm:text-sm mb-1 drop-shadow-sm truncate" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
                  Leg {index + 1}{nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
                  {media.vibe && <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-teal-300/90 not-italic font-mono">· {media.vibe}</span>}
                </p>
                <h2 className="text-[2.35rem] leading-none sm:text-3xl md:text-4xl text-white drop-shadow-md truncate" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
                  {leg.city || 'Untitled stop'}
                </h2>
                <p className="mt-1 text-[10px] text-navy-100/65 font-mono uppercase tracking-wider">
                  {photoStatus}
                </p>
              </div>
              <div className="text-left sm:text-right text-xs text-navy-100/85 min-w-0">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDatesOpen(v => !v);
                  }}
                  className={`pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 sm:-mr-2 tabular-nums ${readOnly ? '' : 'bg-navy-950/35 hover:bg-navy-950/70 hover:text-white border border-white/10'}`}
                  title="Edit dates"
                >
                  {!readOnly && <CalendarDays className="w-3 h-3 text-teal-300" />}
                  {formatRange(leg.startDate, leg.endDate)}
                </button>
                {!readOnly && (
                  <p className="mt-1 hidden sm:block text-[10px] text-teal-200/85 font-mono">edit dates</p>
                )}
                {leg.iata && <p className="text-navy-100/70 mt-1 font-mono truncate">{leg.iata}</p>}
              </div>
            </div>
          }
        />

        {/* Top-right: drag handle (desktop) + close. Mobile: up/down arrows.
            Hidden entirely in read-only / shared view. */}
        {!readOnly && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 pointer-events-auto">
            <div className="flex sm:hidden items-center rounded-md bg-navy-950/55 backdrop-blur overflow-hidden">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                aria-label="Move leg up"
                className="h-7 w-7 flex items-center justify-center text-white/85 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                aria-label="Move leg down"
                className="h-7 w-7 flex items-center justify-center text-white/85 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-white/10"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Visual drag-handle hint — the whole card is grabbable, but
                this gives the user a clear "you can move this" cue. Also
                exposes the keyboard activator (Tab to focus → Space to grab,
                arrows to move, Space to drop). */}
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag to reorder ${leg.city || 'leg'}`}
              title="Drag to reorder (or use the up/down arrows)"
              className="hidden sm:flex h-7 w-7 rounded-md bg-navy-950/55 hover:bg-navy-950/85 backdrop-blur items-center justify-center text-white/85 hover:text-white cursor-grab active:cursor-grabbing touch-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:outline-none"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => dispatch({ type: 'remove_leg', legId: leg.id })}
              aria-label="Remove leg"
              className="h-7 w-7 rounded-md bg-navy-950/55 text-white/85 hover:text-white hover:bg-navy-950/85 flex items-center justify-center backdrop-blur"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!readOnly && datesOpen && (
          <DateEditor
            leg={leg}
            onClose={() => setDatesOpen(false)}
            onApply={(startDate, endDate) => {
              dispatch({ type: 'update_leg', legId: leg.id, patch: { startDate, endDate } });
              if (leg.flight) dispatch({ type: 'clear_flight', legId: leg.id });
              if (leg.hotel) dispatch({ type: 'clear_hotel', legId: leg.id });
              if (leg.itinerary) dispatch({ type: 'clear_itinerary', legId: leg.id });
              setDatesOpen(false);
            }}
          />
        )}
      </div>

      {/* Photo strip — extra richness, lazy-loaded */}
      {media.gallery.length > 0 && (
        <PhotoStrip photos={media.gallery} alt={leg.city} />
      )}

      {/* Things to do — collapsible itinerary panel. Hides itself entirely
          when /api/canvas/itinerary is unavailable so we don't dead-end users. */}
      <ItineraryPanel
        leg={leg}
        dispatch={dispatch}
        readOnly={readOnly}
        interests={state.meta.interests}
      />

      {/* Flight + hotel slots */}
      <div className="p-2.5 sm:p-3 space-y-2">
        {leg.flight ? (
          <>
            <FilledFlightCard
              flight={leg.flight}
              readOnly={readOnly}
              onSwap={() => setPickerOpen('flight')}
              onClear={() => dispatch({ type: 'clear_flight', legId: leg.id })}
            />
            {!readOnly && travellersChanged(leg.flight.pricedFor, state.travellers) && (
              <StalePriceNotice onResearch={() => setPickerOpen('flight')} kind="flight" />
            )}
          </>
        ) : !readOnly ? (
          <EmptySlotButton
            kind="flight"
            label="Pick a flight"
            sub={`Flying into ${leg.city}${leg.iata ? ` (${leg.iata})` : ''}`}
            onClick={() => setPickerOpen('flight')}
          />
        ) : null}

        {leg.hotel ? (
          <>
            <FilledHotelCard
              hotel={leg.hotel}
              readOnly={readOnly}
              onSwap={() => setPickerOpen('hotel')}
              onClear={() => dispatch({ type: 'clear_hotel', legId: leg.id })}
            />
            {!readOnly && travellersChanged(leg.hotel.pricedFor, state.travellers) && (
              <StalePriceNotice onResearch={() => setPickerOpen('hotel')} kind="hotel" />
            )}
          </>
        ) : !readOnly && nights > 0 ? (
          <EmptySlotButton
            kind="hotel"
            label="Pick a hotel"
            sub={`Staying in ${leg.city} · ${nights} night${nights === 1 ? '' : 's'}`}
            onClick={() => setPickerOpen('hotel')}
          />
        ) : !readOnly ? (
          <button
            type="button"
            onClick={() => setDatesOpen(true)}
            className="w-full rounded-lg p-3 sm:p-4 hairline-hover hairline text-left group"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0 h-11 w-11 sm:h-12 sm:w-12 rounded-md bg-navy-800 border border-dashed border-navy-400/40 flex items-center justify-center text-navy-300">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="italic text-sm text-navy-100 mb-0.5" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
                  Add stay dates
                </p>
                <p className="text-xs text-navy-300">This leg has 0 nights. Set a 3-night stay to search hotels.</p>
              </div>
              <p className="hidden sm:block text-[11px] text-navy-400 group-hover:text-teal-400 font-mono">[ dates ]</p>
            </div>
          </button>
        ) : null}
      </div>

      {!readOnly && pickerOpen && (
        <SlotPicker
          open={true}
          onClose={() => setPickerOpen(null)}
          leg={leg}
          legIndex={index}
          state={state}
          tripId={tripId}
          sessionId={sessionId}
          kind={pickerOpen}
          onPickFlight={(f) => dispatch({ type: 'set_flight', legId: leg.id, flight: f })}
          onPickHotel={(h) => dispatch({ type: 'set_hotel',  legId: leg.id, hotel:  h })}
          onSetHomeOrigin={(iata) => dispatch({ type: 'set_home_origin', origin: iata })}
        />
      )}
    </article>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptySlotButton({ kind, label, sub, onClick }: {
  kind: 'flight' | 'hotel'; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg p-3 sm:p-4 hairline-hover hairline text-left group"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex-shrink-0 h-11 w-11 sm:h-12 sm:w-12 rounded-md bg-navy-800 border border-dashed border-navy-400/40 flex items-center justify-center text-navy-300">
          {kind === 'flight'
            ? <Plane className="w-5 h-5" />
            : <Hotel className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="italic text-sm text-navy-100 mb-0.5" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            {label}
          </p>
          <p className="text-xs text-navy-300 truncate">{sub}</p>
        </div>
        <p className="hidden sm:block text-[11px] text-navy-400 group-hover:text-teal-400 font-mono">[ open ]</p>
      </div>
    </button>
  );
}

function DateEditor({
  leg,
  onClose,
  onApply,
}: {
  leg: CanvasLeg;
  onClose: () => void;
  onApply: (startDate: string, endDate: string) => void;
}) {
  const [start, setStart] = useState(leg.startDate);
  const [end, setEnd] = useState(leg.endDate);
  const nights = nightCount(start, end);
  const invalid = !start || !end || nights < 1;

  function applyDefaultStay() {
    const base = start || leg.startDate || new Date().toISOString().slice(0, 10);
    setStart(base);
    setEnd(addDays(base, 3));
  }

  return (
    <div className="absolute left-3 right-3 top-14 z-20 rounded-lg bg-navy-950/95 border border-navy-500/40 shadow-2xl shadow-black/40 p-4 pointer-events-auto sm:left-auto sm:right-4 sm:w-80">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-teal-300 font-mono">Edit dates</p>
        <button type="button" onClick={onClose} className="text-navy-400 hover:text-white">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-navy-400 font-mono">Arrive</span>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              const next = e.target.value;
              setStart(next);
              if (!end || nightCount(next, end) < 1) setEnd(addDays(next, 3));
            }}
            className="w-full h-9 rounded-md bg-navy-900 border border-navy-500/40 px-2 text-xs text-white outline-none focus:border-teal-400"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-navy-400 font-mono">Depart</span>
          <input
            type="date"
            value={end}
            min={start ? addDays(start, 1) : undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full h-9 rounded-md bg-navy-900 border border-navy-500/40 px-2 text-xs text-white outline-none focus:border-teal-400"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={applyDefaultStay}
          className="h-8 px-2.5 rounded-md border border-navy-500/40 text-[11px] text-navy-200 hover:text-white hover:border-teal-400/60"
        >
          Set 3 nights
        </button>
        <p className={`text-[11px] ${invalid ? 'text-amber-300' : 'text-navy-300'}`}>
          {invalid ? 'Choose at least 1 night' : `${nights} night${nights === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          disabled={invalid}
          onClick={() => onApply(start, end)}
          className="h-8 px-3 rounded-md bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-500 disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      {(leg.flight || leg.hotel || leg.itinerary) && (
        <p className="mt-2 text-[10px] text-amber-200/80 leading-snug">
          Date changes clear selected flight, hotel, and itinerary because supplier pricing is date-specific.
        </p>
      )}
    </div>
  );
}

function FilledFlightCard({ flight, readOnly, onSwap, onClear }: {
  flight: NonNullable<CanvasLeg['flight']>; readOnly?: boolean; onSwap: () => void; onClear: () => void;
}) {
  return (
    <div className="rounded-lg p-4 canvas-glass-teal animate-pop-in">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-0.5 h-9 w-9 rounded-md bg-navy-800/80 flex items-center justify-center hairline">
          <Plane className="w-4 h-4 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <span className="text-sm font-mono text-navy-50 tracking-wide">{flight.origin} → {flight.destination}</span>
            <span className="text-xs text-navy-300">{flight.airline} · {flight.flightNumber}</span>
            <span className="text-xs text-navy-400">·</span>
            <span className="text-xs text-navy-300 tabular-nums">{flight.duration} · {flight.stops === 0 ? 'nonstop' : `${flight.stops} stop${flight.stops === 1 ? '' : 's'}`}</span>
          </div>
          {flight.flexibility && (
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider ${
              flight.flexibility === 'Flexible' ? 'bg-teal-500/10 text-teal-400'
              : flight.flexibility === 'Locked' ? 'bg-amber-500/10 text-amber-400'
              : 'bg-navy-700/60 text-navy-200'
            }`}>{flight.flexibility}</span>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-base font-semibold text-white tabular-nums">${(flight.priceCents / 100).toFixed(0)} <span className="text-xs text-navy-300 font-normal">{flight.currency}</span></p>
          {!readOnly && (
            <div className="mt-2 flex items-center gap-2 justify-end">
              <button onClick={onSwap}  className="text-[11px] text-navy-300 hover:text-white font-mono">[ swap ]</button>
              <button onClick={onClear} className="text-[11px] text-navy-400 hover:text-amber-400 font-mono" title="Remove">×</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilledHotelCard({ hotel, readOnly, onSwap, onClear }: {
  hotel: NonNullable<CanvasLeg['hotel']>; readOnly?: boolean; onSwap: () => void; onClear: () => void;
}) {
  // Deterministic gradient palette based on hotel name (matches the picker fallback)
  const palette = pickPalette(hotel.name);
  const initials = hotel.name
    .split(/\s+/)
    .filter(w => w && /[A-Za-z0-9]/.test(w[0]))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');

  const showStars = !!hotel.starRating && hotel.starRating > 0;
  const showScore = hotel.reviewScore !== undefined && hotel.reviewScore > 0;
  // LiteAPI returns dead photo URLs occasionally — track <img> load failure
  // so we cleanly fall back to the gradient + initials instead of a blank.
  const [imgErrored, setImgErrored] = useState(false);

  const initialsBlock = (
    <div
      className={`flex-shrink-0 h-12 w-12 rounded-md bg-gradient-to-br ${palette} flex items-center justify-center font-semibold text-white text-sm`}
      style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
      aria-label={hotel.name}
      role="img"
    >
      {initials || <Hotel className="w-5 h-5 text-teal-200" />}
    </div>
  );

  return (
    <div className="rounded-lg p-4 canvas-glass animate-pop-in">
      <div className="flex items-start gap-4">
        {hotel.image && !imgErrored ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={hotel.image}
            alt={hotel.name}
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            onError={() => setImgErrored(true)}
            className="flex-shrink-0 h-12 w-12 rounded-md object-cover bg-navy-800"
          />
        ) : initialsBlock}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-navy-50 truncate">{hotel.name}</p>
          <p className="text-xs text-navy-300 truncate">{hotel.city}</p>
          {(showStars || showScore) && (
            <div className="flex items-center gap-3 mt-1 text-xs text-navy-300">
              {showStars && <span className="text-amber-400">{'★'.repeat(Math.round(hotel.starRating!))}</span>}
              {showScore && (
                <span className="tabular-nums">{hotel.reviewScore!.toFixed(1)} <span className="text-navy-400">/ 10</span></span>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-base font-semibold text-white tabular-nums">${(hotel.perNightCents / 100).toFixed(0)}<span className="text-xs text-navy-300 font-normal">/n</span></p>
          <p className="text-xs text-navy-300 tabular-nums">${(hotel.totalCents / 100).toFixed(0)} total</p>
          {!readOnly && (
            <div className="mt-1.5 flex items-center gap-2 justify-end">
              <button onClick={onSwap}  className="text-[11px] text-navy-300 hover:text-white font-mono">[ swap ]</button>
              <button onClick={onClear} className="text-[11px] text-navy-400 hover:text-amber-400 font-mono" title="Remove">×</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Same hash-to-palette mapping as the SlotPicker's HotelThumb so the colour for
// a given hotel name is consistent across the picker and the docked card.
const HOTEL_PALETTES = [
  'from-teal-600 to-navy-800',
  'from-amber-600 to-navy-800',
  'from-purple-700 to-navy-800',
  'from-rose-700 to-navy-800',
  'from-blue-700 to-navy-800',
  'from-emerald-700 to-navy-800',
];

function pickPalette(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return HOTEL_PALETTES[Math.abs(h) % HOTEL_PALETTES.length];
}

// Suppress unused MoreHorizontal warning — reserved for the leg-context menu in Phase 2.1.
void MoreHorizontal;

// Whether the price stamped at search time matches the current traveller mix.
// We compare adults + children + sorted childAges. A mismatch means the
// stored priceCents is for a different party size and the user should re-search.
function travellersChanged(
  pricedFor: { adults: number; children: number; childAges?: number[] } | undefined,
  current: { adults: number; children: number; childAges?: number[] },
): boolean {
  if (!pricedFor) return false;       // legacy entries — no stamp, treat as fresh
  if (pricedFor.adults   !== current.adults)   return true;
  if (pricedFor.children !== current.children) return true;
  const a = (pricedFor.childAges ?? []).slice().sort((x, y) => x - y).join(',');
  const b = (current.childAges   ?? []).slice().sort((x, y) => x - y).join(',');
  return a !== b;
}

function StalePriceNotice({ onResearch, kind }: { onResearch: () => void; kind: 'flight' | 'hotel' }) {
  return (
    <div className="rounded-lg p-3 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 animate-pop-in">
      <p className="text-xs text-amber-200/95 leading-snug">
        Travellers changed since this {kind} was priced — re-search for the new mix.
      </p>
      <button
        type="button"
        onClick={onResearch}
        className="flex-shrink-0 text-[11px] font-mono text-amber-200 hover:text-white border border-amber-500/40 hover:border-amber-400 rounded-md px-2 h-7"
      >
        re-search
      </button>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function nightCount(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end   + 'T00:00:00');
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)));
}

function formatRange(start: string, end: string): string {
  const fmt = (ymd: string) => {
    if (!ymd) return '';
    const d = new Date(ymd + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(start)} → ${fmt(end)}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
