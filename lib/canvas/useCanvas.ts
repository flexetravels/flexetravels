// ─── useCanvas — client-side state hook for the Trip Canvas ──────────────────
// Holds CanvasState in memory, applies CanvasOps optimistically, and debounce-
// persists changes to /api/trip/[id]. The hook exposes both a ref-based
// imperative API (for Cmd+K and AI ops) and a state-based reactive API.

'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { applyOp, type CanvasOp } from './state';
import { type CanvasState } from './types';

interface Options {
  tripId:     string;
  sessionId:  string;
  initial:    CanvasState;
  onSaveError?: (err: unknown) => void;
}

interface Result {
  state:      CanvasState;
  dispatch:   (op: CanvasOp) => void;
  isDirty:    boolean;
  isSaving:   boolean;
  lastSavedAt: number | null;
  flush:      () => Promise<void>;        // force-flush pending writes
}

const SAVE_DEBOUNCE_MS = 700;

export function useCanvas({ tripId, sessionId, initial, onSaveError }: Options): Result {
  const [state, dispatchInternal] = useReducer((s: CanvasState, op: CanvasOp) => applyOp(s, op), initial);
  const [isDirty, setIsDirty]     = useState(false);
  const [isSaving, setIsSaving]   = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initial ? Date.now() : null);

  const stateRef     = useRef(state);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef  = useRef<Promise<void> | null>(null);
  const onSaveErrorRef = useRef(onSaveError);

  // Keep refs in sync so async closures see the latest values
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onSaveErrorRef.current = onSaveError; }, [onSaveError]);

  // Persist to server; serialized so two saves never overlap.
  const persist = useCallback(async () => {
    if (inFlightRef.current) {
      // Wait for in-flight write, then run again with the latest state
      await inFlightRef.current;
    }

    const snapshot = stateRef.current;
    setIsSaving(true);

    inFlightRef.current = (async () => {
      try {
        const res = await fetch(`/api/trip/${tripId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessionId, state: snapshot }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Save failed (${res.status})`);
        }
        setLastSavedAt(Date.now());
        // Only clear dirty if no further edits happened during the save
        if (stateRef.current === snapshot) setIsDirty(false);
      } catch (err) {
        onSaveErrorRef.current?.(err);
      } finally {
        setIsSaving(false);
        inFlightRef.current = null;
      }
    })();

    return inFlightRef.current;
  }, [tripId, sessionId]);

  // Schedule a debounced save whenever state changes (after the first render)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setIsDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void persist(); }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, persist]);

  // Flush on unload to avoid losing the last edit
  useEffect(() => {
    function onBeforeUnload() {
      if (!isDirty) return;
      // Best-effort sync POST via sendBeacon (works on unload, no fetch promise)
      try {
        const blob = new Blob(
          [JSON.stringify({ sessionId, state: stateRef.current })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.(`/api/trip/${tripId}`, blob);
      } catch { /* swallow — best-effort */ }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, tripId, sessionId]);

  const flush = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persist();
  }, [persist]);

  return { state, dispatch: dispatchInternal, isDirty, isSaving, lastSavedAt, flush };
}
