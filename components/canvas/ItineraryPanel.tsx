'use client';

// ItineraryPanel — collapsible "things to do" section under each leg's
// photo strip. Lazily fetches /api/canvas/itinerary on first open, caches
// the result on the canvas via the set_itinerary op so a refresh doesn't
// re-call Gemini.
//
// Layout:
//   - Header row: title + day count + refresh button
//   - Mapbox per-leg map with numbered POI pins (LegMap)
//   - Day cards: morning / afternoon / evening items with thumbnails
//   - Click a card → flies the map to its pin
//   - Click a pin → scrolls the matching card into view
//
// Soft fail: hidden when /api/canvas/itinerary returns 503 (Gemini key
// missing) so we don't shout at the user about config they can't fix.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, ChevronDown, ChevronUp, RefreshCw, Star, Clock, ExternalLink } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { CanvasItinerary, CanvasItineraryItem, CanvasLeg } from '@/lib/canvas/types';
import type { CanvasOp } from '@/lib/canvas/state';

// Lazy-load LegMap so the Mapbox bundle only kicks in when the panel opens
const LegMap = dynamic(() => import('./LegMap').then(m => m.LegMap), { ssr: false });

interface Props {
  leg:       CanvasLeg;
  dispatch:  (op: CanvasOp) => void;
  readOnly?: boolean;
  // Used to bias the Gemini suggestions (food / outdoor / etc.)
  interests?: string[];
}

export function ItineraryPanel({ leg, dispatch, readOnly, interests }: Props) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [focusedIdx, setFocusedIdx]   = useState<number | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const autoAttemptedRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stale-by-city detection: itinerary is keyed on the original city; if the
  // user changed the leg's city, throw the cached itinerary out so we re-fetch.
  const cachedItin = useMemo<CanvasItinerary | null>(() => {
    if (!leg.itinerary) return null;
    if (leg.itinerary.city.trim().toLowerCase() !== leg.city.trim().toLowerCase()) return null;
    return leg.itinerary;
  }, [leg.itinerary, leg.city]);

  // Days to plan = nights + 1 (a Mon–Fri trip = 4 nights = 5 daytime windows)
  const daysCount = useMemo(() => {
    if (!leg.startDate || !leg.endDate) return 3;
    const a = new Date(leg.startDate + 'T00:00:00').getTime();
    const b = new Date(leg.endDate   + 'T00:00:00').getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 3;
    const nights = Math.round((b - a) / 86_400_000);
    return Math.max(1, Math.min(7, nights + 1));
  }, [leg.startDate, leg.endDate]);

  const requestKey = useMemo(
    () => `${leg.city.trim().toLowerCase()}|${daysCount}|${(interests ?? []).slice().sort().join(',')}`,
    [leg.city, daysCount, interests],
  );

  const fetchItinerary = useCallback(async (force = false) => {
    if (!leg.city.trim()) return;
    const key = requestKey;
    if (inFlightRef.current === key) return;
    if (!force && autoAttemptedRef.current === key) return;
    if (!force) autoAttemptedRef.current = key;
    inFlightRef.current = key;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const params = new URLSearchParams({ city: leg.city, days: String(daysCount) });
      if (interests && interests.length > 0) params.set('interests', interests.join(','));
      const res = await fetch(`/api/canvas/itinerary?${params.toString()}`, { signal: controller.signal });
      if (res.status === 503) {
        // Backend not configured — quietly hide the panel
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Could not generate itinerary (${res.status})`);
        return;
      }
      const data = await res.json() as CanvasItinerary;
      dispatch({ type: 'set_itinerary', legId: leg.id, itinerary: data });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        setError('Planning took too long. Try again in a moment.');
      } else {
        setError('Network error — try again.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (inFlightRef.current === key) inFlightRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }, [leg.id, leg.city, daysCount, interests, dispatch, requestKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // First open → fetch if no cached itinerary
  useEffect(() => {
    if (!open) return;
    if (cachedItin) return;
    if (loading) return;
    if (unavailable) return;
    fetchItinerary(false);
  }, [open, cachedItin, loading, unavailable, fetchItinerary]);

  // Hide the panel entirely when the backend is unconfigured. We could show a
  // collapsed "things to do" stub, but it would invite users to click into a
  // dead end — better to keep the canvas clean.
  if (unavailable) return null;
  // Read-only / shared canvases — only render if the trip already has an
  // itinerary. Don't generate one on someone else's behalf.
  if (readOnly && !cachedItin) return null;

  return (
    <div className="px-3 pt-1 pb-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-lg p-2.5 hairline-hover hairline flex items-center gap-3 text-left group"
        aria-expanded={open}
      >
        <div className="flex-shrink-0 h-7 w-7 rounded-md bg-navy-800/80 flex items-center justify-center">
          <Compass className="w-3.5 h-3.5 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs italic text-navy-50" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            Things to do in {leg.city}
          </p>
          <p className="text-[10px] text-navy-400 font-mono">
            {cachedItin
              ? `${cachedItin.days.length} day plan · ${countItems(cachedItin)} stops${cachedItin.source === 'gemini-grounded' ? ' · grounded' : ''}`
              : `Plan ${daysCount} day${daysCount === 1 ? '' : 's'} of ideas`}
          </p>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-navy-400 group-hover:text-white" />
          : <ChevronDown className="w-4 h-4 text-navy-400 group-hover:text-white" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 animate-pop-in">
          {loading && (
            <div className="rounded-lg p-6 hairline text-center">
              <div className="inline-block h-5 w-5 border-2 border-teal-400/60 border-t-transparent rounded-full animate-spin" />
              <p className="text-[11px] text-navy-300 mt-2 font-mono uppercase tracking-wider">Planning your days…</p>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg p-3 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-200/95">{error}</p>
              <button
                type="button"
                onClick={() => fetchItinerary(true)}
                disabled={loading}
                className="flex-shrink-0 text-[11px] font-mono text-amber-200 hover:text-white border border-amber-500/40 rounded-md px-2 h-7"
              >
                {loading ? 'wait' : 'retry'}
              </button>
            </div>
          )}

          {cachedItin && !loading && (
            <>
              {/* Map first — gives spatial context before the user reads the cards */}
              <LegMap
                itinerary={cachedItin}
                hotelLat={undefined /* hotel coords not on CanvasHotelSelection yet */}
                hotelLon={undefined}
                hotelName={leg.hotel?.name}
                focusedIndex={focusedIdx}
                onSelectItem={(idx) => {
                  setFocusedIdx(idx);
                  // Scroll the matching card into view
                  const node = document.querySelector(`[data-itin-idx="${leg.id}-${idx}"]`);
                  if (node) (node as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              />

              <DayCards
                legId={leg.id}
                itinerary={cachedItin}
                focusedIndex={focusedIdx}
                onFocus={setFocusedIdx}
              />

              {!readOnly && (
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[10px] text-navy-500 font-mono">
                    {cachedItin.source === 'gemini-grounded'
                      ? 'Grounded with Google Search'
                      : cachedItin.source === 'gemini'
                        ? 'Generated by Gemini'
                        : 'Live public travel data'}
                    {' · '}
                    cached · regenerate to refresh
                  </p>
                  <button
                    type="button"
                    onClick={() => fetchItinerary(true)}
                    disabled={loading}
                    className="flex items-center gap-1 text-[11px] font-mono text-navy-300 hover:text-white"
                    title="Regenerate"
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    regenerate
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Day cards ──────────────────────────────────────────────────────────────

function DayCards({ legId, itinerary, focusedIndex, onFocus }: {
  legId:        string;
  itinerary:    CanvasItinerary;
  focusedIndex: number | null;
  onFocus:      (idx: number | null) => void;
}) {
  // Flatten so each item's data-itin-idx maps cleanly to LegMap's flat order
  let runningIdx = 0;
  return (
    <div className="space-y-3">
      {itinerary.days.map((day) => (
        <section key={day.day} className="rounded-lg hairline bg-navy-900/30 p-3">
          <header className="flex items-baseline gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-teal-400/90 font-mono">Day {day.day}</span>
            <span className="text-[10px] text-navy-400">·</span>
            <span className="text-[10px] text-navy-400 font-mono">{day.items.length} stop{day.items.length === 1 ? '' : 's'}</span>
          </header>
          <ul className="space-y-2">
            {day.items.map((item) => {
              const flatIdx = runningIdx++;
              const focused = focusedIndex === flatIdx;
              return (
                <ItemCard
                  key={`${day.day}-${flatIdx}`}
                  item={item}
                  flatIdx={flatIdx}
                  legId={legId}
                  focused={focused}
                  onClick={() => onFocus(focused ? null : flatIdx)}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemCard({ item, flatIdx, legId, focused, onClick }: {
  item:    CanvasItineraryItem;
  flatIdx: number;
  legId:   string;
  focused: boolean;
  onClick: () => void;
}) {
  const ringCls = focused
    ? 'ring-2 ring-amber-400/60 bg-navy-900/60'
    : 'hairline-hover hairline bg-navy-900/30';
  return (
    <li
      data-itin-idx={`${legId}-${flatIdx}`}
      className={`rounded-md p-2.5 transition-shadow ${ringCls}`}
    >
      <button type="button" onClick={onClick} className="w-full flex items-start gap-3 text-left">
        <div className="flex-shrink-0 h-12 w-12 rounded-md bg-navy-800 overflow-hidden hairline flex items-center justify-center font-mono text-[11px] text-navy-300">
          {item.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.photo}
              alt={item.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span>{flatIdx + 1}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-amber-300/90">#{flatIdx + 1}</span>
            <p className="text-sm text-navy-50 font-medium truncate">{item.name}</p>
            {item.timeOfDay && (
              <span className="text-[10px] uppercase tracking-wider text-navy-400 font-mono">{item.timeOfDay}</span>
            )}
          </div>
          {item.why && (
            <p className="text-xs text-navy-300 mt-1 leading-snug line-clamp-2">{item.why}</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-navy-400 font-mono">
            {typeof item.rating === 'number' && (
              <span className="inline-flex items-center gap-1">
                <Star className="w-2.5 h-2.5 text-amber-400" />
                {item.rating.toFixed(1)}
                {item.ratingCount ? <span className="text-navy-500">({formatCount(item.ratingCount)})</span> : null}
              </span>
            )}
            {item.durationMinutes && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {formatDuration(item.durationMinutes)}
              </span>
            )}
            {typeof item.priceLevel === 'number' && (
              <span title="Price level">{'$'.repeat(Math.max(1, item.priceLevel))}</span>
            )}
            {item.mapsUrl && (
              <a
                href={item.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-navy-300 hover:text-white"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                maps
              </a>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function countItems(itin: CanvasItinerary): number {
  let n = 0;
  for (const d of itin.days) n += d.items.length;
  return n;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
