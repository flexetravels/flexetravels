'use client';

// CommandBar — Cmd+K command palette for the Trip Canvas.
// Submits the user's natural-language command to /api/trip/[id]/command,
// receives a sequence of CanvasOps, and applies them via dispatch.

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';
import { type CanvasOp } from '@/lib/canvas/state';

interface Props {
  open:       boolean;
  onClose:    () => void;
  tripId:     string;
  sessionId:  string;
  dispatch:   (op: CanvasOp) => void;
  onOpenChat?: () => void;
}

const SUGGESTIONS = [
  'avoid Air India on all legs',
  'flying from Toronto',
  'add 3 days in Rome after Paris',
  'find a cheaper hotel near the Pantheon',
  'extend Paris by 2 nights',
  'we are 2 adults and 2 kids',
  'remove leg 2',
  'find a nonstop flight for leg 1',
];

export function CommandBar({ open, onClose, tripId, sessionId, dispatch, onOpenChat }: Props) {
  const [value, setValue]       = useState('');
  const [pending, setPending]   = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'message' | 'error' | 'success'; text: string } | null>(null);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setValue('');
      setFeedback(null);
    }
  }, [open]);

  // Esc to close, Enter to submit
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const submit = useCallback(async (text: string) => {
    if (!text.trim() || pending) return;
    setPending(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/trip/${tripId}/command`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, message: text.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFeedback({ kind: 'error', text: data.error || `Command failed (${res.status})` });
        return;
      }

      const data: { ops: CanvasOp[]; message?: string } = await res.json();
      const ops = Array.isArray(data.ops) ? data.ops : [];

      // Apply ops in order
      for (const op of ops) dispatch(op);

      // Show feedback then close (or stay open if there's a question)
      if (ops.length > 0) {
        const summary = summarizeOps(ops);
        setFeedback({ kind: 'success', text: summary });
        setValue('');
        // Auto-close after a beat so the user sees the canvas update
        setTimeout(onClose, 900);
      } else if (data.message) {
        setFeedback({ kind: 'message', text: data.message });
        setValue('');
      } else {
        setFeedback({ kind: 'message', text: 'No changes made.' });
      }
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setPending(false);
    }
  }, [tripId, sessionId, dispatch, onClose, pending]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-navy-950/80 backdrop-blur-sm animate-fade-in-up"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-xl border border-navy-500/40 bg-navy-900/95 shadow-2xl overflow-hidden">
        {/* Input row */}
        <form
          onSubmit={(e) => { e.preventDefault(); submit(value); }}
          className="flex items-center gap-3 px-4 h-14 border-b border-navy-500/30"
        >
          <Sparkles className="w-4 h-4 text-teal-400 flex-shrink-0" />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="avoid Air India · push Day 5 → 6 · find a kid-friendly resort…"
            autoFocus
            disabled={pending}
            maxLength={500}
            className="flex-1 bg-transparent text-white placeholder:text-navy-300 outline-none text-sm disabled:opacity-50"
          />
          {pending ? (
            <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
          ) : value.trim().length > 0 ? (
            <button
              type="submit"
              className="h-7 w-7 rounded-md bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center"
              aria-label="Send command"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="canvas-kbd">esc</kbd>
          )}
        </form>

        {/* Feedback row */}
        {feedback && (
          <div className={`px-4 py-3 text-sm border-b border-navy-500/30 ${
            feedback.kind === 'error'    ? 'bg-amber-500/10 text-amber-400'
            : feedback.kind === 'success' ? 'bg-teal-500/10 text-teal-400'
            : 'text-navy-100'
          }`}>
            {feedback.text}
          </div>
        )}

        {/* Suggestions */}
        {!feedback && (
          <div className="max-h-96 overflow-y-auto py-2">
            <p className="px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono">
              Try
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setValue(s); submit(s); }}
                disabled={pending}
                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-navy-700/40 text-left disabled:opacity-50"
              >
                <span className="h-7 w-7 rounded-md bg-navy-700 flex items-center justify-center text-teal-400 text-xs flex-shrink-0" style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.4)' }}>↳</span>
                <span className="flex-1 text-sm text-navy-50">{s}</span>
                <kbd className="canvas-kbd">↩</kbd>
              </button>
            ))}
            <p className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono">
              Mode
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenChat?.();
              }}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-navy-700/40 text-left"
            >
              <span className="h-7 w-7 rounded-md bg-navy-700 flex items-center justify-center text-amber-400 text-xs flex-shrink-0" style={{ boxShadow: 'inset 0 0 0 1px rgba(74, 88, 120, 0.4)' }}>💬</span>
              <span className="flex-1 text-sm text-navy-50">Open full chat panel</span>
              <kbd className="canvas-kbd">⇧↩</kbd>
            </button>
          </div>
        )}

        {/* Footer hints */}
        <div className="border-t border-navy-500/30 px-4 h-10 flex items-center justify-between text-[11px] text-navy-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="canvas-kbd">↩</kbd> apply</span>
            <span className="flex items-center gap-1"><kbd className="canvas-kbd">esc</kbd> close</span>
          </div>
          <span className="font-mono text-navy-500">FlexeTravels</span>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function summarizeOps(ops: CanvasOp[]): string {
  const verbs: string[] = [];
  for (const op of ops) {
    switch (op.type) {
      case 'set_home_origin':
        verbs.push(`Set home airport to ${op.origin}`);
        break;
      case 'add_leg':
        verbs.push(`Added ${op.leg.city}${op.leg.iata ? ` (${op.leg.iata})` : ''}`);
        break;
      case 'remove_leg':
        verbs.push('Removed a leg');
        break;
      case 'set_travellers':
        verbs.push(`Updated travellers to ${op.adults} adult${op.adults === 1 ? '' : 's'}${op.children > 0 ? ` + ${op.children} child${op.children === 1 ? '' : 'ren'}` : ''}`);
        break;
      case 'set_travel_docs':
        verbs.push(`Updated passport / transit filters${op.passportCountry ? ` for ${op.passportCountry}` : ''}`);
        break;
      case 'set_flight':
        verbs.push(`Picked ${op.flight.airline} ${op.flight.flightNumber || ''}`);
        break;
      case 'set_hotel':
        verbs.push(`Picked ${op.hotel.name}`);
        break;
      case 'update_leg':
        verbs.push('Updated leg');
        break;
      default:
        verbs.push(`Applied ${op.type}`);
    }
  }
  return verbs.join(' · ');
}

// Suppress unused warning for X icon (kept for future close-button design)
void X;
