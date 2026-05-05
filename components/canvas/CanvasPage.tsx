'use client';

// CanvasPage — interactive Trip Canvas (Phase 2).
// Holds canvas state via useCanvas, renders DayLegBlock per leg, AddLegDialog
// for adding stops, and a sticky checkout strip that hands the cart off to
// /booking through ft_cart sessionStorage (same shape /chat already uses).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { useCanvas } from '@/lib/canvas/useCanvas';
import { computeTotals } from '@/lib/canvas/state';
import { type CanvasFlightSelection, type CanvasHotelSelection, type CanvasState } from '@/lib/canvas/types';
import { generateSessionId } from '@/lib/utils';
import { DayLegBlock } from './DayLegBlock';
import { AddLegDialog } from './AddLegDialog';
import { CommandBar } from './CommandBar';
import { ChatPanel } from './ChatPanel';
import { InterestsSheet, VIBE_LABELS } from './InterestsSheet';
import { TravellersChip } from './TravellersChip';
import { TravelDocsChip } from './TravelDocsChip';
import { MessageSquare, Sparkles, Share2, Check, RefreshCw } from 'lucide-react';

// Lazy-load the route map — Mapbox GL is ~470KB. Defer it so the initial
// canvas bundle stays lean and the map loads as soon as the user gives us
// something to render.
const RouteMap = dynamic(() => import('./RouteMap').then(m => m.RouteMap), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl bg-navy-900/40 hairline h-44 md:h-48 flex items-center justify-center">
      <p className="text-[10px] uppercase tracking-[0.2em] text-navy-400 font-mono">loading map…</p>
    </div>
  ),
});

interface Props { tripId: string }

interface TripPayload {
  id:        string;
  title:     string;
  status:    string;
  state:     CanvasState;
  updatedAt: string;
  readOnly?: boolean;
}

export default function CanvasPage({ tripId }: Props) {
  const router         = useRouter();
  const searchParams   = useSearchParams();
  const sharedView     = searchParams?.get('view') === 'shared';
  const [trip, setTrip]               = useState<TripPayload | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [titleDraft, setTitleDraft]   = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const sessionIdRef = useRef<string>('');

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (sharedView) {
      // Read-only view — never read or create a sessionId
      (async () => {
        try {
          const res = await fetch(`/api/trip/${tripId}?view=shared`);
          if (res.status === 404) { setLoadError('This shared trip can’t be found.'); return; }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setLoadError(data.error || 'Could not load trip');
            return;
          }
          const data: TripPayload = await res.json();
          setTrip({ ...data, readOnly: true });
          setTitleDraft(data.title);
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : 'Network error');
        }
      })();
      return;
    }

    sessionIdRef.current = getOrCreateSessionId();
    if (!sessionIdRef.current) return;

    (async () => {
      try {
        const res = await fetch(`/api/trip/${tripId}?sessionId=${encodeURIComponent(sessionIdRef.current)}`);
        if (res.status === 403) { setLoadError('This trip belongs to a different session.'); return; }
        if (res.status === 404) { setLoadError('We couldn’t find this trip. It may have been archived.'); return; }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLoadError(data.error || 'Could not load trip');
          return;
        }
        const data: TripPayload = await res.json();
        setTrip(data);
        setTitleDraft(data.title);
        // Stamp this as the user's most-recent trip so /trip (no id) can
        // offer to resume it. Skipped in shared-view to not overwrite the
        // owner's pointer when a third party views the read-only link.
        try { window.localStorage.setItem('ft_last_trip_id', tripId); } catch { /* swallow */ }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Network error');
      }
    })();
  }, [tripId, sharedView]);

  // ── Title persistence (separate from canvas state PATCH) ─────────────────
  const persistTitle = useCallback(async (newTitle: string) => {
    if (!trip || !sessionIdRef.current) return;
    setTitleSaving(true);
    try {
      const res = await fetch(`/api/trip/${trip.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId: sessionIdRef.current, title: newTitle.trim() || 'Untitled trip' }),
      });
      if (res.ok) {
        const data = await res.json();
        setTrip(prev => prev ? { ...prev, title: data.title, updatedAt: data.updatedAt } : prev);
      }
    } finally {
      setTitleSaving(false);
    }
  }, [trip]);

  useEffect(() => {
    if (!trip) return;
    if (titleDraft === trip.title) return;
    const handle = setTimeout(() => { void persistTitle(titleDraft); }, 600);
    return () => clearTimeout(handle);
  }, [titleDraft, trip, persistTitle]);

  if (loadError) return <ErrorScreen message={loadError} />;
  if (!trip)     return <LoadingScreen />;

  return <LoadedCanvas
    trip={trip}
    titleDraft={titleDraft}
    setTitleDraft={setTitleDraft}
    titleSaving={titleSaving}
    sessionId={sessionIdRef.current}
    readOnly={!!trip.readOnly}
    onCheckout={(state) => handleCheckout(state, router, trip.id)}
  />;
}

// ─── Loaded canvas — runs `useCanvas` only after we have the initial state ───

function LoadedCanvas({
  trip, titleDraft, setTitleDraft, titleSaving, sessionId, readOnly, onCheckout,
}: {
  trip:      TripPayload;
  titleDraft: string;
  setTitleDraft: (s: string) => void;
  titleSaving: boolean;
  sessionId: string;
  readOnly:  boolean;
  onCheckout: (state: CanvasState) => void;
}) {
  // In read-only / shared mode, useCanvas is wired to a dummy session id and
  // would still attempt PATCHes — so we replace dispatch with a no-op below.
  const canvas = useCanvas({
    tripId:    trip.id,
    sessionId: readOnly ? 'shared-readonly' : sessionId,
    initial:   trip.state,
    onSaveError: (err) => { if (!readOnly) console.error('[canvas save]', err); },
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- replaced once at construction
  const dispatch = readOnly ? (() => { /* no-op in shared view */ }) : canvas.dispatch;
  const state         = canvas.state;
  const isSaving      = readOnly ? false : canvas.isSaving;
  const lastSavedAt   = readOnly ? null  : canvas.lastSavedAt;

  const totals  = useMemo(() => computeTotals(state), [state]);
  const hasLegs = state.legs.length > 0;
  const [commandOpen,   setCommandOpen]   = useState(false);
  const [chatOpen,      setChatOpen]      = useState(false);
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [refreshingSelections, setRefreshingSelections] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);
  const staleSelectionCount = useMemo(() => countStaleSelections(state), [state]);

  const refreshSelectedForTravellers = useCallback(async () => {
    if (readOnly || refreshingSelections) return;
    setRefreshingSelections(true);
    setRefreshSummary(null);
    let refreshed = 0;
    let replaced = 0;
    let cleared = 0;

    try {
      for (let i = 0; i < state.legs.length; i++) {
        const leg = state.legs[i];
        const prev = i > 0 ? state.legs[i - 1] : null;
        const origin = leg.flight?.origin
          ?? prev?.iata
          ?? prev?.flight?.destination
          ?? state.homeOrigin
          ?? null;

        if (leg.flight && origin && leg.iata) {
          const nextFlight = await refreshFlightSelection(leg.flight, {
            origin,
            destination: leg.flight.destination || leg.iata,
            departureDate: leg.startDate,
            travellers: state.travellers,
          });
          if (nextFlight) {
            const sameItinerary = sameFlightItinerary(leg.flight, nextFlight);
            dispatch({ type: 'set_flight', legId: leg.id, flight: nextFlight });
            refreshed += 1;
            if (!sameItinerary) replaced += 1;
          } else {
            dispatch({ type: 'clear_flight', legId: leg.id });
            cleared += 1;
          }
        }

        if (leg.hotel) {
          const nextHotel = await refreshHotelSelection(leg.hotel, {
            destination: leg.hotel.city || leg.city,
            checkIn: leg.startDate,
            checkOut: leg.endDate,
            travellers: state.travellers,
          });
          if (nextHotel) {
            dispatch({ type: 'set_hotel', legId: leg.id, hotel: nextHotel });
            refreshed += 1;
          } else {
            dispatch({ type: 'clear_hotel', legId: leg.id });
            cleared += 1;
          }
        }
      }

      const parts = [`Updated ${refreshed} selected item${refreshed === 1 ? '' : 's'} for the current travellers.`];
      if (replaced > 0) parts.push(`${replaced} flight${replaced === 1 ? '' : 's'} moved to the closest available replacement.`);
      if (cleared > 0) parts.push(`${cleared} item${cleared === 1 ? '' : 's'} had no live availability and was cleared.`);
      setRefreshSummary(parts.join(' '));
    } catch (e) {
      setRefreshSummary(e instanceof Error ? e.message : 'Could not refresh selected prices right now.');
    } finally {
      setRefreshingSelections(false);
    }
  }, [dispatch, readOnly, refreshingSelections, state]);

  // Cmd+K / Ctrl+K opens the command bar from anywhere on the page
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Show the "what's your vibe?" sheet once for fresh canvases — never nag,
  // and never in read-only / shared mode.
  useEffect(() => {
    if (readOnly) return;
    const interests   = state.meta.interests ?? [];
    const promptedAt  = state.meta.interestsPromptedAt;
    const isFresh     = state.meta.createdFrom === 'new' || !state.meta.createdFrom;
    if (isFresh && !promptedAt && interests.length === 0) {
      // Tiny delay so the canvas paints before the modal slides in
      const t = setTimeout(() => setInterestsOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [state.meta.interests, state.meta.interestsPromptedAt, state.meta.createdFrom, readOnly]);

  // ── Drag-reorder via @dnd-kit ─────────────────────────────────────────────
  // PointerSensor with a 6px activation distance lets the user click buttons
  // on the leg card without accidentally starting a drag, while still
  // initiating a drag immediately on the first real drag motion. TouchSensor
  // uses a 250ms long-press so taps still work on mobile.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor,{ coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  function onDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = state.legs.map(l => l.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
    dispatch({ type: 'reorder_legs', legIds: arrayMove(ids, oldIdx, newIdx) });
  }

  // Up/down arrow fallback for users on touch devices or who prefer
  // keyboard nav. Same op, just driven by buttons inside the leg card.
  function moveLeg(legId: string, direction: -1 | 1) {
    const ids = state.legs.map(l => l.id);
    const i   = ids.indexOf(legId);
    if (i === -1) return;
    const j = i + direction;
    if (j < 0 || j >= ids.length) return;
    dispatch({ type: 'reorder_legs', legIds: arrayMove(ids, i, j) });
  }

  const activeLeg = activeDragId ? state.legs.find(l => l.id === activeDragId) : null;

  const totalDateRange = useMemo(() => formatTripRange(state), [state]);

  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 antialiased">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-navy-500/30 bg-navy-950/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-navy-100 hover:text-white">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-[10px] font-bold text-white">F</div>
            <span className="text-sm font-semibold tracking-tight">FlexeTravels</span>
          </Link>
          <span className="text-navy-500">/</span>
          {readOnly ? (
            <span
              className="text-white italic min-w-0 flex-1 truncate px-2 py-1 -ml-2"
              style={{ fontFamily: 'var(--font-spectral), Georgia, serif', fontSize: '15px' }}
              title="Shared view — read-only"
            >
              {titleDraft || 'Untitled trip'}
            </span>
          ) : (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Untitled trip"
              maxLength={120}
              className="bg-transparent outline-none text-white placeholder:text-navy-400 min-w-0 flex-1 hover:bg-navy-800/40 rounded px-2 py-1 -ml-2 focus:bg-navy-800/60 italic"
              style={{ fontFamily: 'var(--font-spectral), Georgia, serif', fontSize: '15px' }}
            />
          )}
          <span className="text-[10px] text-navy-400 font-mono uppercase tracking-wider min-w-[64px] text-right">
            {readOnly ? 'shared' : (titleSaving || isSaving ? 'saving…' : (lastSavedAt ? 'saved' : ''))}
          </span>
          <div className="flex items-center gap-2">
            {!readOnly && (
              <ShareButton tripId={trip.id} />
            )}
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-md border border-navy-500/40 text-xs text-navy-200 hover:text-white hover:border-teal-500/50"
                  title="Open chat panel"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-teal-400" />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  title="Type or ask Maya (Cmd+K)"
                  className="flex items-center gap-2 px-3 h-8 rounded-md border border-navy-500/40 text-xs text-navy-200 hover:text-white hover:border-teal-500/50 transition"
                >
                  <svg className="w-3.5 h-3.5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 9.5a7.5 7.5 0 0013.15 7.15z"/></svg>
                  <span className="hidden sm:inline">type or ask</span>
                  <span className="canvas-kbd">⌘K</span>
                </button>
              </>
            )}
            {readOnly && (
              <Link
                href="/trip"
                className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-teal-500/40 text-xs text-teal-300 hover:text-white hover:border-teal-500"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Plan your own</span>
              </Link>
            )}
          </div>
        </div>
        {readOnly && (
          <div className="bg-teal-500/8 border-t border-teal-500/20 text-center py-1.5 text-[11px] uppercase tracking-[0.18em] text-teal-300 font-mono">
            shared trip · view only
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 pb-32">
        {/* Trip header */}
        <section className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-teal-500 font-mono mb-3">
            {hasLegs ? `Trip · ${state.legs.length} leg${state.legs.length === 1 ? '' : 's'}` : 'New trip · planning'}
          </p>
          {readOnly ? (
            <h1
              className="text-4xl md:text-5xl text-white tracking-tight font-medium"
              style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
            >
              {titleDraft || trip.title || 'Untitled trip'}
            </h1>
          ) : (
            <div className="group relative max-w-3xl">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Name this trip"
                maxLength={120}
                aria-label="Trip name"
                className="w-full bg-transparent border-b border-transparent hover:border-navy-500/50 focus:border-teal-400/70 outline-none pr-10 pb-1 text-4xl md:text-5xl text-white placeholder:text-navy-500 tracking-tight font-medium transition"
                style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
              />
              <span className="pointer-events-none absolute right-0 top-3 text-[10px] uppercase tracking-[0.18em] font-mono text-navy-500 group-focus-within:text-teal-300">
                edit
              </span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-navy-200">
            {readOnly ? (
              <span>
                {state.travellers.adults} adult{state.travellers.adults === 1 ? '' : 's'}
                {state.travellers.children > 0 && ` · ${state.travellers.children} child${state.travellers.children === 1 ? '' : 'ren'}`}
              </span>
            ) : (
              <TravellersChip
                adults={state.travellers.adults}
                children={state.travellers.children}
                childAges={state.travellers.childAges}
                onChange={({ adults, children, childAges }) =>
                  dispatch({ type: 'set_travellers', adults, children, childAges })
                }
              />
            )}
            {totalDateRange && (
              <>
                <span className="text-navy-500">·</span>
                <span className="tabular-nums">{totalDateRange}</span>
              </>
            )}
            <span className="text-navy-500">·</span>
            <HomeOriginChip
              value={state.homeOrigin}
              onChange={(iata) => dispatch({ type: 'set_home_origin', origin: iata || null })}
            />
            {!readOnly && (
              <>
                <span className="text-navy-500">·</span>
                <TravelDocsChip
                  value={state.meta.travelDocs}
                  onChange={(travelDocs) => dispatch({
                    type: 'set_travel_docs',
                    passportCountry: travelDocs.passportCountry,
                    visaCountries: travelDocs.visaCountries,
                  })}
                />
              </>
            )}
          </div>
          {/* Vibe pills — tap to open the picker again */}
          <VibeStrip
            interests={state.meta.interests ?? []}
            onEdit={() => setInterestsOpen(true)}
          />
          {!readOnly && staleSelectionCount > 0 && (
            <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-amber-100">
                  Traveller count changed for {staleSelectionCount} selected item{staleSelectionCount === 1 ? '' : 's'}.
                </p>
                <p className="text-xs text-amber-200/75 mt-1">
                  Refresh once to reprice selected flights and hotels for the current passengers. If the same flight no longer has seats, we will replace it with the closest live option or clear it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSelectedForTravellers()}
                disabled={refreshingSelections}
                className="h-9 px-3 rounded-md bg-amber-400 text-navy-950 hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingSelections ? 'animate-spin' : ''}`} />
                Refresh selected prices
              </button>
            </div>
          )}
          {!readOnly && refreshSummary && (
            <p className="mt-2 text-xs text-navy-300">{refreshSummary}</p>
          )}
        </section>

        {/* Route map — only mounted when the trip has at least one anchor.
            This defers the ~470KB Mapbox GL bundle until the user actually
            has somewhere to plot. */}
        {(hasLegs || state.homeOrigin) && (
          <section className="mb-6">
            <RouteMap state={state} />
          </section>
        )}

        {/* Legs */}
        <section className="space-y-6">
          {state.legs.length === 0 ? (
            readOnly ? (
              <div className="rounded-xl bg-navy-900/40 hairline p-10 text-center text-navy-300 text-sm">
                This shared trip has no legs yet.
              </div>
            ) : (
              <EmptyState
                onAdd={(leg) => dispatch({ type: 'add_leg', leg })}
                onOpenChat={() => setChatOpen(true)}
              />
            )
          ) : (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveDragId(null)}
              >
                <SortableContext
                  items={state.legs.map(l => l.id)}
                  strategy={verticalListSortingStrategy}
                  disabled={readOnly}
                >
                  <div className="space-y-6">
                    {state.legs.map((leg, i) => (
                      <DayLegBlock
                        key={leg.id}
                        leg={leg}
                        index={i}
                        state={state}
                        dispatch={dispatch}
                        tripId={trip.id}
                        sessionId={sessionId}
                        readOnly={readOnly}
                        isDragGhost={activeDragId === leg.id}
                        onMoveUp={readOnly ? undefined : () => moveLeg(leg.id, -1)}
                        onMoveDown={readOnly ? undefined : () => moveLeg(leg.id, 1)}
                        canMoveUp={!readOnly && i > 0}
                        canMoveDown={!readOnly && i < state.legs.length - 1}
                      />
                    ))}
                  </div>
                </SortableContext>

                {/* Floating preview while dragging — looks like the card you
                    grabbed, follows the cursor with a slight tilt + shadow. */}
                <DragOverlay dropAnimation={{ duration: 200 }}>
                  {activeLeg ? (
                    <div className="rounded-xl bg-navy-900/85 ring-2 ring-teal-500/60 shadow-2xl shadow-teal-500/20 px-5 py-3 -rotate-1 cursor-grabbing">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-teal-400 font-mono">moving leg</p>
                      <h3 className="text-2xl text-white" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
                        {activeLeg.city}
                      </h3>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
              {!readOnly && (
                <AddLegDialog
                  previousLeg={state.legs[state.legs.length - 1]}
                  trigger={
                    <button
                      type="button"
                      className="w-full rounded-xl py-5 text-sm text-navy-300 hover:text-white border border-dashed border-navy-500/40 hover:border-teal-500/40 hover:bg-navy-900/40 flex items-center justify-center gap-2 transition"
                    >
                      <Plus className="w-4 h-4" />
                      <span style={{ fontFamily: 'var(--font-spectral), Georgia, serif', fontStyle: 'italic' }}>
                        add another chapter
                      </span>
                      <span className="canvas-kbd ml-2">⌘L</span>
                    </button>
                  }
                  onAdd={(leg) => dispatch({ type: 'add_leg', leg })}
                />
              )}
            </>
          )}
        </section>
      </main>

      {/* Sticky checkout strip */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-navy-500/30 bg-navy-950/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono">Total</p>
              <p className="text-white text-xl font-semibold tabular-nums">
                {hasLegs ? `$${(totals.totalCents / 100).toFixed(0)}` : <span className="text-navy-500">—</span>}
              </p>
            </div>
            <div className="h-10 border-l border-navy-500/30"></div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono">Our fee</p>
              <p className="text-white text-sm font-medium tabular-nums">$20 USD <span className="text-navy-300 text-xs">flat</span></p>
            </div>
            {hasLegs && totals.savingsVsOtaCents > 0 && (
              <>
                <div className="h-10 border-l border-navy-500/30 hidden md:block"></div>
                <div className="hidden md:block">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-teal-500 font-mono">vs typical OTAs</p>
                  <OtaSavingsLine savingsCents={totals.savingsVsOtaCents} />
                </div>
              </>
            )}
          </div>
          {readOnly ? (
            <Link
              href="/trip"
              className="h-10 px-5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium flex items-center gap-2"
            >
              Plan your own
              <Sparkles className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              disabled={!isCheckoutReady(state)}
              onClick={async () => {
                // Flush any in-flight canvas-state PATCH before we leave so
                // the trip on the server matches what we're about to send to
                // /booking. Without this, a fast click after picking a hotel
                // can race the 700ms debounce and leave the server stale.
                if (!readOnly) {
                  try { await canvas.flush(); } catch { /* swallow — best-effort */ }
                }
                onCheckout(state);
              }}
              className={`h-10 px-5 rounded-md text-white text-sm font-medium flex items-center gap-2 ${
                isCheckoutReady(state)
                  ? 'bg-teal-600 hover:bg-teal-500 cursor-pointer'
                  : 'bg-navy-700/60 cursor-not-allowed text-navy-300'
              }`}
              title={isCheckoutReady(state) ? 'Continue to checkout' : 'Pick at least one flight or hotel first'}
            >
              Continue to checkout
              <span className="canvas-kbd bg-teal-700/60 border-teal-400/30 text-teal-50">⌘↵</span>
            </button>
          )}
        </div>
      </footer>

      {!readOnly && (
        <>
          <CommandBar
            open={commandOpen}
            onClose={() => setCommandOpen(false)}
            tripId={trip.id}
            sessionId={sessionId}
            dispatch={dispatch}
            onOpenChat={() => setChatOpen(true)}
          />

          <ChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            tripId={trip.id}
            sessionId={sessionId}
            state={state}
            dispatch={dispatch}
          />

          <InterestsSheet
            open={interestsOpen}
            initial={state.meta.interests ?? []}
            onClose={() => setInterestsOpen(false)}
            onSave={(interests) => {
              dispatch({ type: 'set_interests', interests });
              setInterestsOpen(false);
            }}
            onSkip={() => {
              dispatch({ type: 'mark_interests_prompted' });
              setInterestsOpen(false);
            }}
          />
        </>
      )}
    </div>
  );
}

// ─── Share button — copies a read-only canvas URL to the clipboard ──────────

function ShareButton({ tripId }: { tripId: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/trip/${tripId}?view=shared`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers
        const t = document.createElement('textarea');
        t.value = url; t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // If clipboard fails (e.g. blocked permissions), open a prompt as a last resort
      window.prompt('Copy this share link:', url);
    }
  }, [tripId]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-md border border-navy-500/40 text-xs text-navy-200 hover:text-white hover:border-teal-500/50"
      title="Copy a read-only share link"
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-teal-400" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Share2 className="w-3.5 h-3.5 text-teal-400" />
          <span>Share</span>
        </>
      )}
    </button>
  );
}

// ─── OTA savings line + disclaimer popover ───────────────────────────────────
// The "save ~$X vs OTAs" pitch is a heuristic, not a quoted price from a
// competitor. Click to reveal exactly how we calculate it so we can stay
// honest with the user (and avoid an FTC-style "deceptive comparison" claim).

function OtaSavingsLine({ savingsCents }: { savingsCents: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-teal-400 text-sm font-medium tabular-nums hover:text-teal-300 inline-flex items-center gap-1"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        save ~${(savingsCents / 100).toFixed(0)}
        <span className="text-navy-300 text-xs font-normal">(estimate)</span>
        <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full border border-teal-500/40 text-[9px] font-semibold text-teal-400">i</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="How we estimate OTA savings"
          className="absolute bottom-full mb-3 right-0 w-72 rounded-lg p-4 bg-navy-900 text-navy-100 text-xs leading-relaxed shadow-xl hairline z-30"
        >
          <p className="text-white font-medium mb-2" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            How we estimate this
          </p>
          <p className="text-navy-200 mb-2">
            We compare your trip&apos;s wholesale price plus our flat $20 fee against a heuristic baseline of the same itinerary at a typical OTA (about <span className="text-teal-300 font-mono">+6%</span> commission blended across flights and hotels).
          </p>
          <p className="text-navy-300">
            It&apos;s a rough estimate — not a live quote from any competitor. Real savings depend on the OTA, the day, and the specific flight or hotel.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Vibe pill strip ─────────────────────────────────────────────────────────
// Shows the picked vibes inline under the trip header. Tap to re-open the
// picker; if no vibes are set, render a small "tell us your vibe" affordance.

function VibeStrip({ interests, onEdit }: { interests: string[]; onEdit: () => void }) {
  if (interests.length === 0) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 inline-flex items-center gap-2 px-2.5 h-7 rounded-md border border-dashed border-navy-500/40 hover:border-teal-500/40 text-xs text-navy-300 hover:text-white transition"
      >
        <Sparkles className="w-3 h-3 text-teal-400" />
        <span style={{ fontFamily: 'var(--font-spectral), Georgia, serif', fontStyle: 'italic' }}>
          tell us your vibe
        </span>
      </button>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {interests.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 px-2 h-6 rounded-md bg-teal-500/10 text-teal-300 text-[11px] font-mono uppercase tracking-wider"
        >
          {VIBE_LABELS[id] ?? id}
        </span>
      ))}
      <button
        type="button"
        onClick={onEdit}
        className="text-[11px] text-navy-400 hover:text-teal-400 font-mono"
      >
        [ edit ]
      </button>
    </div>
  );
}

// ─── Home origin chip ────────────────────────────────────────────────────────
// Inline editable chip in the trip header. Click to edit; submit on Enter.

function HomeOriginChip({ value, onChange }: { value: string | null; onChange: (iata: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value ?? '');

  const normalize = (raw: string): string | null => {
    const s = raw.trim();
    if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
    const map: Record<string, string> = {
      toronto: 'YYZ', vancouver: 'YVR', montreal: 'YUL', calgary: 'YYC',
      'new york': 'JFK', nyc: 'JFK', 'los angeles': 'LAX', la: 'LAX',
      chicago: 'ORD', boston: 'BOS', seattle: 'SEA', miami: 'MIA',
      london: 'LHR', paris: 'CDG', tokyo: 'NRT', dubai: 'DXB',
      mumbai: 'BOM', delhi: 'DEL', bangalore: 'BLR', bengaluru: 'BLR',
    };
    return map[s.toLowerCase()] ?? null;
  };

  function commit() {
    const n = normalize(draft);
    if (n) onChange(n);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter')   commit();
          if (e.key === 'Escape')  setEditing(false);
        }}
        placeholder="YYZ"
        maxLength={32}
        className="h-6 w-24 px-2 rounded-md bg-navy-800/60 border border-teal-500/40 text-white text-xs uppercase tracking-wider font-mono outline-none focus:border-teal-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value ?? ''); setEditing(true); }}
      className="group inline-flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-navy-800/40 text-xs text-navy-300 hover:text-white"
      title={value ? 'Click to change home airport' : 'Click to set home airport'}
    >
      <span className="font-mono tracking-wider">
        {value ? <>from <span className="text-teal-400">{value}</span></> : 'set home airport'}
      </span>
      <svg className="w-3 h-3 text-navy-400 group-hover:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
    </button>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  onAdd,
  onOpenChat,
}: {
  onAdd:        (leg: import('@/lib/canvas/types').CanvasLeg) => void;
  onOpenChat:   () => void;
}) {
  return (
    <section
      className="rounded-xl bg-navy-900/40 p-10 md:p-16 text-center"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.3)' }}
    >
      <div className="max-w-md mx-auto">
        <div className="mx-auto mb-5 h-12 w-12 rounded-2xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4M3 7v10l9 4m-9-14l9 4m0 0v10m0-10l9-4m-9 14l9-4M3 17l9 4"/>
          </svg>
        </div>
        <p className="text-2xl text-white mb-2 italic" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
          Where to?
        </p>
        <p className="text-navy-200 mb-6 text-sm leading-relaxed">
          Add a stop to start your trip — or just <button onClick={onOpenChat} className="text-teal-400 hover:text-teal-300 underline underline-offset-2">tell Maya</button> what you have in mind and the canvas will fill itself.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <AddLegDialog
            trigger={
              <Button className="bg-teal-600 hover:bg-teal-500 text-white">
                <Plus className="w-4 h-4 mr-1" />
                Add your first stop
              </Button>
            }
            onAdd={onAdd}
          />
          <button
            type="button"
            onClick={onOpenChat}
            className="h-10 px-4 rounded-md border border-navy-500/40 text-navy-200 hover:text-white hover:border-teal-500/50 text-sm font-medium flex items-center gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5 text-teal-400" />
            Plan via chat
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Loading / error screens ─────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
        <p className="text-xs uppercase tracking-[0.2em] text-teal-400 font-mono">Loading your trip</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-mono mb-3">Trip unavailable</p>
        <h1 className="text-2xl font-semibold text-white mb-3">{message}</h1>
        <div className="flex items-center justify-center gap-3 mt-6">
          <Link href="/trip" className="px-5 h-10 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium flex items-center">
            Start a new trip
          </Link>
          <Link href="/chat" className="px-4 h-10 rounded-md border border-navy-500/40 text-navy-200 hover:text-white text-sm font-medium flex items-center">
            Open chat instead
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Cart hand-off ───────────────────────────────────────────────────────────

function isCheckoutReady(state: CanvasState): boolean {
  // At least one leg with a flight OR a hotel; otherwise nothing to book
  return state.legs.some(l => l.flight || l.hotel);
}

function countStaleSelections(state: CanvasState): number {
  return state.legs.reduce((count, leg) => {
    return count
      + (leg.flight && travellersChanged(leg.flight.pricedFor, state.travellers) ? 1 : 0)
      + (leg.hotel && travellersChanged(leg.hotel.pricedFor, state.travellers) ? 1 : 0);
  }, 0);
}

function travellersChanged(
  pricedFor: { adults: number; children: number; childAges?: number[] } | undefined,
  current: CanvasState['travellers'],
): boolean {
  if (!pricedFor) return false;
  if (pricedFor.adults !== current.adults) return true;
  if (pricedFor.children !== current.children) return true;
  const a = (pricedFor.childAges ?? []).slice().sort((x, y) => x - y).join(',');
  const b = (current.childAges ?? []).slice(0, current.children).sort((x, y) => x - y).join(',');
  return a !== b;
}

interface FlightSearchResult {
  id: string;
  origin: string;
  destination: string;
  airline: string;
  departure: string;
  arrival: string;
  duration: string;
  stops: number;
  stopAirports?: string[];
  cabinClass?: string;
  price: number;
  currency?: string;
  refundable?: boolean;
  baggage?: string;
  flexibilitySummary?: string;
  fareVariants?: Array<{ flexibilityLabel?: CanvasFlightSelection['flexibility']; flexibilitySummary?: string }>;
  segments?: NonNullable<CanvasFlightSelection['segments']>;
  legs?: NonNullable<CanvasFlightSelection['legs']>;
  returnSegments?: NonNullable<CanvasFlightSelection['returnSegments']>;
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnStops?: number;
  returnStopAirports?: string[];
}

interface HotelSearchResult {
  id: string;
  bookingToken?: string;
  name: string;
  city?: string;
  stars?: number;
  rating?: number;
  pricePerNight: number;
  totalPrice: number;
  currency?: string;
  cancellation?: string;
  image?: string;
}

async function refreshFlightSelection(
  current: CanvasFlightSelection,
  opts: {
    origin: string;
    destination: string;
    departureDate: string;
    travellers: CanvasState['travellers'];
  },
): Promise<CanvasFlightSelection | null> {
  const ages = opts.travellers.childAges ?? [];
  const infants = ages.slice(0, opts.travellers.children).filter(age => age < 2).length;
  const childrenAges = ages.slice(0, opts.travellers.children).filter(age => age >= 2);
  const res = await fetch('/api/search/flights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: opts.origin,
      destination: opts.destination,
      departureDate: opts.departureDate,
      adults: opts.travellers.adults,
      childrenAges: childrenAges.length > 0 ? childrenAges : undefined,
      infants: infants > 0 ? infants : undefined,
      cabinClass: (current.cabinClass as 'economy' | 'premium_economy' | 'business' | 'first') || 'economy',
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { flights?: FlightSearchResult[] };
  const flights = data.flights ?? [];
  if (flights.length === 0) return null;

  const match = flights.find(f => sameFlightResult(current, f))
    ?? flights.find(f => f.airline === current.airline && f.origin === current.origin && f.destination === current.destination)
    ?? flights[0];
  return flightResultToCanvas(match, opts.travellers);
}

async function refreshHotelSelection(
  current: CanvasHotelSelection,
  opts: {
    destination: string;
    checkIn: string;
    checkOut: string;
    travellers: CanvasState['travellers'];
  },
): Promise<CanvasHotelSelection | null> {
  const childAges = (opts.travellers.childAges ?? []).slice(0, opts.travellers.children);
  const res = await fetch('/api/search/hotels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: opts.destination,
      checkIn: opts.checkIn,
      checkOut: opts.checkOut,
      adults: opts.travellers.adults,
      childrenAges: childAges.length > 0 ? childAges : undefined,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { hotels?: HotelSearchResult[] };
  const hotels = data.hotels ?? [];
  if (hotels.length === 0) return null;
  const match = hotels.find(h => h.id === current.hotelId)
    ?? hotels.find(h => h.name.trim().toLowerCase() === current.name.trim().toLowerCase())
    ?? null;
  return match ? hotelResultToCanvas(match, opts.destination, opts.travellers) : null;
}

function sameFlightResult(current: CanvasFlightSelection, next: FlightSearchResult): boolean {
  return current.origin === next.origin
    && current.destination === next.destination
    && current.flightNumber === (next.legs?.[0]?.segments?.[0]?.flightNumber || '')
    && current.departureTime.slice(0, 16) === next.departure.slice(0, 16);
}

function sameFlightItinerary(a: CanvasFlightSelection, b: CanvasFlightSelection): boolean {
  return a.origin === b.origin
    && a.destination === b.destination
    && a.airline === b.airline
    && a.flightNumber === b.flightNumber
    && a.departureTime.slice(0, 16) === b.departureTime.slice(0, 16);
}

function flightResultToCanvas(f: FlightSearchResult, travellers: CanvasState['travellers']): CanvasFlightSelection {
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
    flexibilitySummary: f.fareVariants?.[0]?.flexibilitySummary ?? f.flexibilitySummary,
    refundable:    f.refundable,
    baggage:       f.baggage,
    segments:      f.segments ?? f.legs?.[0]?.segments,
    legs:          f.legs,
    returnSegments: f.returnSegments,
    returnDeparture: f.returnDeparture,
    returnArrival:   f.returnArrival,
    returnDuration:  f.returnDuration,
    returnStops:     f.returnStops,
    returnStopAirports: f.returnStopAirports,
    pricedFor: {
      adults: travellers.adults,
      children: travellers.children,
      childAges: travellers.childAges,
    },
  };
}

function hotelResultToCanvas(h: HotelSearchResult, fallbackCity: string, travellers: CanvasState['travellers']): CanvasHotelSelection {
  return {
    rateId: h.bookingToken || h.id,
    hotelId: h.id,
    name: h.name,
    city: h.city || fallbackCity,
    starRating: h.stars,
    reviewScore: h.rating,
    perNightCents: Math.round(h.pricePerNight * 100),
    totalCents: Math.round(h.totalPrice * 100),
    currency: h.currency || 'USD',
    cancellationPolicy: h.cancellation,
    image: h.image,
    pricedFor: {
      adults: travellers.adults,
      children: travellers.children,
      childAges: travellers.childAges,
    },
  };
}

function handleCheckout(state: CanvasState, router: ReturnType<typeof useRouter>, tripId: string) {
  if (!isCheckoutReady(state)) return;

  // Multi-leg cart shape: arrays of every leg's flight + hotel (in trip
  // order). For backwards compatibility with the legacy /chat → /booking
  // flow, we ALSO populate the singular `flight` / `hotel` fields with the
  // first entry — older consumers (a stale /booking page, etc.) keep working.
  const flights = state.legs
    .filter(l => l.flight)
    .map(l => canvasFlightToCart(l.flight!));
  const hotels  = state.legs
    .filter(l => l.hotel)
    .map(l => canvasHotelToCart(l.hotel!, l));

  // /booking reads `cart.children?.count` and `cart.children?.ages` (the shape
  // /chat already writes). Match that here so the checkout's children UI lights
  // up. We also keep the flat `children` count for /booking's older fallback.
  const childAges = state.travellers.childAges ?? [];
  const cart = {
    flights,
    hotels,
    flight:    flights[0] ?? null,    // legacy single-flight fallback
    hotel:     hotels[0]  ?? null,    // legacy single-hotel fallback
    adults:    state.travellers.adults,
    children:  { count: state.travellers.children, ages: childAges.slice(0, state.travellers.children) },
    savedAt:   Date.now(),
    source:    'canvas',
    // Carry tripId so /booking can offer a "Back to your trip" link.
    // Persisted to localStorage too so the homepage / nav can offer to
    // resume even after the booking sessionStorage entry is cleared.
    tripId,
  };

  try {
    window.sessionStorage.setItem('ft_cart', JSON.stringify(cart));
    window.localStorage.setItem('ft_last_trip_id', tripId);
  } catch (e) {
    console.error('[canvas checkout] sessionStorage failed', e);
  }

  // Pass the trip id on the booking URL too so the back-link works even when
  // sessionStorage is cleared (e.g. the user closed and reopened the tab).
  router.push(`/booking?from=trip&tripId=${encodeURIComponent(tripId)}`);
}

function canvasFlightToCart(f: NonNullable<import('@/lib/canvas/types').CanvasLeg['flight']>) {
  return {
    id:           f.offerId,
    offerId:      f.offerId,
    airline:      f.airline,
    origin:       f.origin,
    destination:  f.destination,
    departure:    f.departureTime,
    arrival:      f.arrivalTime,
    duration:     f.duration,
    stops:        f.stops,
    stopAirports: f.stopAirports ?? [],
    price:        f.priceCents / 100,
    currency:     f.currency,
    cabinClass:   f.cabinClass,
    segments:     f.segments ?? f.legs?.[0]?.segments ?? [],
    legs:         f.legs,
    refundable:   f.refundable ?? false,
    baggage:      f.baggage,
    flexibilityLabel: f.flexibility,
    flexibilitySummary: f.flexibilitySummary,
    returnSegments: f.returnSegments,
    returnDeparture: f.returnDeparture,
    returnArrival:   f.returnArrival,
    returnDuration:  f.returnDuration,
    returnStops:     f.returnStops,
    returnStopAirports: f.returnStopAirports,
  };
}

function canvasHotelToCart(h: NonNullable<import('@/lib/canvas/types').CanvasLeg['hotel']>, leg: import('@/lib/canvas/types').CanvasLeg) {
  return {
    id:            h.hotelId,
    rateId:        h.rateId,
    // Checkout needs the exact provider rate token. Without this, canvas hotel
    // picks looked selected but failed at passenger review as "rate token is
    // missing". Keep both names for legacy consumers.
    bookingToken:  h.rateId,
    name:          h.name,
    city:          h.city,
    checkIn:       leg.startDate,
    checkOut:      leg.endDate,
    pricePerNight: h.perNightCents / 100,
    totalPrice:    h.totalCents / 100,
    currency:      h.currency,
    starRating:    h.starRating,
    reviewScore:   h.reviewScore,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTripRange(state: CanvasState): string {
  if (state.legs.length === 0) return '';
  const first = state.legs[0]?.startDate;
  const last  = state.legs[state.legs.length - 1]?.endDate;
  if (!first || !last) return '';
  const fmt = (ymd: string) => {
    const d = new Date(ymd + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(first)} → ${fmt(last)}`;
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'ft_session_id';
  let id = window.localStorage.getItem(KEY);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    id = generateSessionId();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
