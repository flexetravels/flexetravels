'use client';

// ChatPanel — slide-over conversational chat that lives inside the canvas.
// Drives canvas changes through the same /api/trip/[id]/command endpoint as
// Cmd+K, but keeps a persistent message thread so the AI can plan across
// multiple turns ("…and add 3 days in Rome after Paris").
//
// State persists per-trip in localStorage (key: `ft_chat_<tripId>`) so the
// thread survives refresh.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, Loader2, MessageSquare } from 'lucide-react';
import { type CanvasOp } from '@/lib/canvas/state';
import { type CanvasState } from '@/lib/canvas/types';

interface Props {
  open:       boolean;
  onClose:    () => void;
  tripId:     string;
  sessionId:  string;
  state:      CanvasState;
  dispatch:   (op: CanvasOp) => void;
}

interface Msg {
  role:    'user' | 'assistant' | 'system';
  content: string;
  ops?:    CanvasOp[];          // ops applied as part of this assistant turn
  ts:      number;
}

const STARTER_PROMPTS = [
  'plan a 7-day trip from Toronto to Paris next month',
  'I want a beach holiday for 5 nights, surprise me',
  'add 3 days in Rome after Paris',
  'find a cheaper hotel near the Pantheon',
];

const HISTORY_LIMIT = 50;

export function ChatPanel({ open, onClose, tripId, sessionId, state, dispatch }: Props) {
  const storageKey = `ft_chat_${tripId}`;

  const [messages, setMessages] = useState<Msg[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(`ft_chat_${tripId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-HISTORY_LIMIT);
    } catch {
      return [];
    }
  });
  const [draft,   setDraft]   = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Persist conversation
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-HISTORY_LIMIT)));
    } catch { /* quota — ignore */ }
  }, [messages, storageKey]);

  // Auto-scroll to bottom on new messages or when opened
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length, pending]);

  // Esc to close
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
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setDraft('');
    setPending(true);

    const userMsg: Msg = { role: 'user', content: trimmed, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    // Build history payload — last N user/assistant pairs
    const history = [...messages, userMsg]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      const res = await fetch(`/api/trip/${tripId}/command`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId,
          message: trimmed,
          history: history.slice(0, -1),     // exclude the just-sent message; the server appends it
          state,                              // latest optimistic canvas, avoids chat using stale DB order
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessages(prev => [...prev, {
          role:    'system',
          content: data.error || `Request failed (${res.status})`,
          ts:      Date.now(),
        }]);
        return;
      }

      const data: { ops: CanvasOp[]; message?: string; partial?: boolean } = await res.json();
      const ops = Array.isArray(data.ops) ? data.ops : [];

      // Apply ops to the canvas (partial wins still count)
      for (const op of ops) dispatch(op);

      const assistantText = data.message?.trim()
        || (ops.length > 0
          ? summarizeOps(ops)
          : "I couldn't make a canvas change from that. Try naming the leg/city and the exact flight or hotel change you want.");
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: assistantText,
        ops:     ops.length > 0 ? ops : undefined,
        ts:      Date.now(),
      }]);
      if (data.partial) {
        setMessages(prev => [...prev, {
          role:    'system',
          content: 'Heads up: that was a big request and I had to stop partway. Ask me to keep going and I will pick up where I left off.',
          ts:      Date.now(),
        }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role:    'system',
        content: e instanceof Error ? e.message : 'Network error',
        ts:      Date.now(),
      }]);
    } finally {
      setPending(false);
    }
  }, [tripId, sessionId, dispatch, pending, messages]);

  function clearThread() {
    setMessages([]);
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-navy-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 z-50 h-screen w-full sm:max-w-md lg:max-w-lg bg-navy-950 border-l border-navy-500/40 flex flex-col shadow-2xl animate-slide-in-right"
        role="dialog"
        aria-label="Chat with FlexeTravels"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 h-14 border-b border-navy-500/30">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-white">Chat with Maya</h2>
            <span className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono">{messages.length} msg</span>
          </div>
          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button
                onClick={clearThread}
                className="text-[11px] text-navy-300 hover:text-amber-400 px-2 h-7 rounded font-mono"
                title="Clear conversation"
              >
                clear
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close chat"
              className="h-7 w-7 rounded-md hover:bg-navy-800/60 text-navy-300 hover:text-white flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !pending && (
            <EmptyChat onPick={(p) => submit(p)} />
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}

          {pending && (
            <div className="flex items-center gap-2 text-navy-300 text-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
              <span className="italic">Maya is thinking…</span>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); submit(draft); }}
          className="border-t border-navy-500/30 p-3 bg-navy-900/40"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit(draft);
                }
              }}
              placeholder="Plan a trip, swap a hotel, add a stop…"
              rows={2}
              maxLength={500}
              disabled={pending}
              className="flex-1 resize-none bg-navy-800/60 border border-navy-500/40 rounded-md px-3 py-2 text-sm text-white placeholder:text-navy-400 focus:border-teal-500/60 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!draft.trim() || pending}
              className="h-10 w-10 rounded-md bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-navy-400 font-mono uppercase tracking-wider">
            <span className="canvas-kbd">↩</span> send · <span className="canvas-kbd">⇧↩</span> new line · <span className="canvas-kbd">esc</span> close
          </p>
        </form>
      </aside>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyChat({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="text-center py-8">
      <div className="mx-auto mb-4 h-10 w-10 rounded-2xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-teal-400" />
      </div>
      <p
        className="text-xl text-white italic mb-2"
        style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
      >
        Tell me about your trip
      </p>
      <p className="text-navy-300 text-sm mb-5 px-4">
        I&apos;ll search real flights and hotels, and update the canvas as we go.
      </p>
      <div className="space-y-2 px-2">
        {STARTER_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="w-full text-left px-3 py-2.5 rounded-md hover:bg-navy-800/60 border border-navy-500/30 hover:border-teal-500/40 text-sm text-navy-100 transition"
          >
            <span className="text-teal-400 mr-2">↳</span>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl bg-teal-600/90 text-white px-3.5 py-2 text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'system') {
    return (
      <div className="text-amber-400 text-xs px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20">
        {msg.content}
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-[10px] font-bold text-white">
        M
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-navy-50 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        {msg.ops && msg.ops.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.ops.map((op, i) => (
              <span
                key={i}
                className="text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-400 border border-teal-500/20"
              >
                {labelForOp(op)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function labelForOp(op: CanvasOp): string {
  switch (op.type) {
    case 'set_home_origin': return `home → ${op.origin}`;
    case 'add_leg':         return `+ ${op.leg.city}${op.leg.iata ? ` (${op.leg.iata})` : ''}`;
    case 'remove_leg':      return 'leg removed';
    case 'set_travellers':  return `${op.adults}A${op.children > 0 ? `+${op.children}C` : ''}`;
    case 'set_travel_docs': return `docs: ${op.passportCountry ?? 'updated'}`;
    case 'set_flight':      return `flight: ${op.flight.airline}`;
    case 'set_hotel':       return `hotel: ${op.hotel.name.slice(0, 20)}`;
    case 'update_leg':      return 'leg updated';
    default:                return op.type;
  }
}

function summarizeOps(ops: CanvasOp[]): string {
  return `Done — applied ${ops.length} change${ops.length === 1 ? '' : 's'}.`;
}
