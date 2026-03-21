'use client';

import { useChat } from 'ai/react';
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import {
  Send, PanelLeftOpen, Sun, Moon, RotateCcw,
  Plane, Sparkles, ChevronDown, MapPin, AlertCircle, WifiOff,
} from 'lucide-react';
import { ChatMessage, TypingIndicator } from '@/components/ChatMessage';
import { ItinerarySidebar } from '@/components/ItinerarySidebar';
import { CheckoutCard } from '@/components/CheckoutCard';
import { cn, generateSessionId, detectCommand } from '@/lib/utils';
import type { Itinerary, ItineraryDay, FlightResult, HotelResult } from '@/lib/types';

// ─── Session ID ───────────────────────────────────────────────────────────
let _sid: string | null = null;
function getSessionId() {
  if (!_sid) _sid = generateSessionId();
  return _sid;
}

// ─── Hotkey hook ──────────────────────────────────────────────────────────
function useHotkey(key: string, fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === key) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [key, fn]);
}

// ─── Theme toggle (hydration-safe) ────────────────────────────────────────
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-xl hover:bg-black/[.06] dark:hover:bg-white/[.08]
                 text-muted-foreground hover:text-foreground transition-colors"
      title="Toggle theme"
    >
      {mounted
        ? theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
        : <span className="block w-4 h-4" />}
    </button>
  );
}

// ─── Destination chips — only cities with confirmed LiteAPI hotel inventory ───
const DESTINATIONS = [
  { name: 'Cancún, Mexico',    img: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=56&h=56&fit=crop&q=80', msg: 'I want a beach vacation to Cancun Mexico for 7 days flying from Toronto' },
  { name: 'New York City',     img: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=56&h=56&fit=crop&q=80', msg: 'Plan a 5 day NYC trip from Vancouver for 2 adults' },
  { name: 'Punta Cana',        img: 'https://images.unsplash.com/photo-1584553421349-3557471bed79?w=56&h=56&fit=crop&q=80', msg: 'I want a 7 day all-inclusive beach vacation to Punta Cana Dominican Republic from Toronto' },
  { name: 'Tokyo, Japan',      img: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=56&h=56&fit=crop&q=80', msg: 'Plan a cultural trip to Tokyo Japan for 10 days from Vancouver' },
  { name: 'Bali, Indonesia',   img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=56&h=56&fit=crop&q=80', msg: 'I want a relaxing wellness trip to Bali for 10 days departing Toronto' },
  { name: 'Barcelona, Spain',  img: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=56&h=56&fit=crop&q=80', msg: 'Plan a 7 day food and culture trip to Barcelona Spain from Montreal' },
  { name: 'Dubai, UAE',        img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=56&h=56&fit=crop&q=80', msg: 'I want a luxury 6 day trip to Dubai UAE flying from Toronto' },
  { name: 'Miami, Florida',    img: 'https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=56&h=56&fit=crop&q=80', msg: 'Plan a 5 day Miami beach trip from Toronto for 2 people' },
] as const;

// ─── Welcome screen ───────────────────────────────────────────────────────
function WelcomeScreen({ onSend }: { onSend: (msg: string) => void }) {
  return (
    <div className="welcome-wrap">
      {/* Logo orb */}
      <div className="relative mb-8">
        <div className="w-[72px] h-[72px] rounded-2xl
                        bg-gradient-to-br from-teal-500 via-teal-600 to-teal-900
                        flex items-center justify-center
                        shadow-[0_12px_48px_rgba(13,138,98,.35)]">
          <Plane className="w-9 h-9 text-white" strokeWidth={1.8} />
        </div>
        <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full
                        bg-gradient-to-br from-amber-400 to-orange-500
                        flex items-center justify-center shadow-lg">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
      </div>

      <h1 className="text-[2rem] sm:text-[2.4rem] font-bold tracking-tight
                     text-foreground mb-3 leading-tight">
        Where to next?
      </h1>
      <p className="text-muted-foreground text-[.9375rem] max-w-[420px]
                    leading-relaxed mb-10">
        Tell me your dream destination — I&apos;ll find real flights &amp; hotels
        and build your perfect itinerary.
      </p>

      {/* Destination chips */}
      <div className="flex flex-wrap justify-center gap-2.5 max-w-[520px] mb-10">
        {DESTINATIONS.map((d) => (
          <button
            key={d.name}
            type="button"
            onClick={() => onSend(d.msg)}
            className="dest-chip"
          >
            <Image
              src={d.img}
              alt={d.name}
              width={28}
              height={28}
              className="w-7 h-7 rounded-full object-cover ring-1 ring-white/20"
              unoptimized
            />
            <span>{d.name}</span>
          </button>
        ))}
      </div>

      {/* Feature row */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2
                      text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Plane className="w-3.5 h-3.5" /> Real-time flights
        </span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/30 hidden sm:block" />
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Live hotel prices
        </span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/30 hidden sm:block" />
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> AI itineraries
        </span>
      </div>

      {/* Flat fee badge */}
      <div className="mt-5 px-4 py-2 rounded-full bg-teal-50 dark:bg-teal-900/30
                      border border-teal-200 dark:border-teal-800 text-xs text-teal-700
                      dark:text-teal-300 font-medium flex items-center gap-1.5">
        <span className="text-teal-500">✦</span>
        Flat $20 service fee per booking — no hidden charges
      </div>

      {/* Legal disclaimer */}
      <p className="mt-4 text-[0.7rem] text-muted-foreground/50 text-center max-w-[420px] leading-relaxed">
        FlexeTravels is a technology platform, not a licensed travel agent (no IATA/CPBC).
        Flights booked via Duffel (IATA-accredited). Prices from multiple engines — always verify before payment.
      </p>
    </div>
  );
}

// ─── API error banner ────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  const isKeyErr = /api.?key|unauthori|authenticat/i.test(message);
  return (
    <div className="error-bubble">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm">
          {isKeyErr ? 'API key not configured' : 'Something went wrong'}
        </p>
        <p className="text-xs mt-0.5 opacity-80">
          {isKeyErr
            ? 'Add a valid ANTHROPIC_API_KEY to .env.local and restart the dev server.'
            : message}
        </p>
      </div>
    </div>
  );
}

// ─── Input bar ────────────────────────────────────────────────────────────
interface InputBarProps {
  input: string;
  isLoading: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

function InputBar({ input, isLoading, onChange, onSubmit, onStop }: InputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && input.trim()) onSubmit();
    }
  };

  const cmd = detectCommand(input);

  return (
    <div className="input-dock">
      <div className="input-inner">
        {cmd && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="bg-teal-100 dark:bg-teal-900/40 text-teal-700
                             dark:text-teal-300 font-mono px-2.5 py-0.5 rounded-full">
              {cmd}
            </span>
            <span className="text-muted-foreground">command detected</span>
          </div>
        )}

        <div className="input-bar">
          <textarea
            ref={ref}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder="Describe your dream trip… (Shift+Enter for new line)"
            className="chat-textarea"
            rows={1}
            disabled={isLoading}
          />
          {isLoading ? (
            <button type="button" onClick={onStop} className="stop-btn" title="Stop">
              <span className="w-3.5 h-3.5 rounded-sm bg-red-500 block" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { if (input.trim()) onSubmit(); }}
              disabled={!input.trim()}
              className={cn('send-btn', input.trim() ? 'active' : 'inactive')}
              title="Send (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-xs text-muted-foreground/50">
          AI may make errors — always verify prices before booking.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [ghostEnabled, setGhostEnabled]   = useState(false);
  const [itinerary, setItinerary]         = useState<Itinerary | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [apiError, setApiError]           = useState<string | null>(null);

  // ── Inline checkout cart ─────────────────────────────────────────────────
  const [cartFlight,   setCartFlight]   = useState<FlightResult | null>(null);
  const [cartHotel,    setCartHotel]    = useState<HotelResult  | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef    = useRef<HTMLDivElement>(null);

  // Ghost preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ft_ghost');
      if (saved) setGhostEnabled(saved === '1');
    } catch { /* SSR safety */ }
  }, []);

  const handleGhostToggle = (v: boolean) => {
    setGhostEnabled(v);
    try { localStorage.setItem('ft_ghost', v ? '1' : '0'); } catch { /* ignore */ }
  };

  // ── useChat ─────────────────────────────────────────────────────────────
  const {
    messages, input, handleInputChange, handleSubmit,
    isLoading, stop, setInput, setMessages, append,
  } = useChat({
    api: '/api/chat',
    body: { sessionId: getSessionId() },
    onError: (err) => {
      setApiError(err?.message ?? 'Unknown error');
    },
    onFinish: (msg) => {
      setApiError(null);
      extractItinerary(msg.content);
    },
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Scroll btn
  const onScroll = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  };

  // Hotkeys
  useHotkey('/', useCallback(() => setSidebarOpen(o => !o), []));
  useHotkey('k', useCallback(() => {
    setMessages([]); setItinerary(null); setApiError(null);
    setCartFlight(null); setCartHotel(null); setShowCheckout(false);
  }, [setMessages]));

  // Itinerary extractor
  const extractItinerary = useCallback((text: string) => {
    const m = text.match(/\[ITINERARY\]\s*(\{[\s\S]*?\})\s*\[\/ITINERARY\]/);
    if (!m) return;
    try { setItinerary(JSON.parse(m[1]) as Itinerary); setSidebarOpen(true); }
    catch { /* skip */ }
  }, []);

  // Card selection — stores flight/hotel in cart and sends a selection message.
  // Once both are chosen, the inline CheckoutCard appears automatically.
  const handleSelectFlight = useCallback((f: FlightResult) => {
    setCartFlight(f);
    const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency }).format(f.price);
    const dep   = new Date(f.departure).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    // Offer ID is intentionally NOT included here — the checkout card owns it.
    // Keeping it out prevents the AI from triggering premature booking tool calls.
    append({
      role: 'user',
      content: `[FLIGHT_SELECTED] ${f.airline} ${f.origin}→${f.destination}, ${dep}, ${f.stops === 0 ? 'non-stop' : `${f.stops} stop`}, ${price}.`,
    });
  }, [append]);

  const handleSelectHotel = useCallback((h: HotelResult) => {
    setCartHotel(h);
    setShowCheckout(true);
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: h.currency ?? 'USD' }).format(n);
    const bookable = h.bookingToken && !h.isSample;
    // [HOTEL_SELECTED] tag tells the AI to show checkout instructions only.
    append({
      role: 'user',
      content: bookable
        ? `[HOTEL_SELECTED] ${h.name}, ${h.stars}★, ${fmt(h.pricePerNight)}/night (${fmt(h.totalPrice)} total), ${h.checkIn}→${h.checkOut}.`
        : `[HOTEL_SELECTED] ${h.name}, ${h.stars}★, ~${fmt(h.pricePerNight)}/night (indicative pricing).`,
    });
  }, [append]);

  // Checkout callbacks
  const handleCheckoutConfirmed = useCallback((flightRef?: string, hotelRef?: string) => {
    setShowCheckout(false);
    setCartFlight(null);
    setCartHotel(null);
    const parts: string[] = [];
    if (flightRef) parts.push(`Flight booked ✅ (ref: ${flightRef})`);
    if (hotelRef)  parts.push(`Hotel booked ✅ (ref: ${hotelRef})`);
    if (parts.length > 0) {
      append({ role: 'user', content: `Booking completed! ${parts.join(' · ')}. Payment submitted.` });
    }
  }, [append]);

  const handleCheckoutClose = useCallback(() => {
    setShowCheckout(false);
  }, []);

  const handleEditDay = useCallback((day: ItineraryDay) => {
    setInput(`/edit-day-${day.day} `);
  }, [setInput]);

  const doSubmit = useCallback(() => {
    setApiError(null);
    handleSubmit(new Event('submit') as unknown as React.FormEvent);
  }, [handleSubmit]);

  // ── Auto-send prompt from landing page card clicks ─────────────────────────
  // APPROACH: read sessionStorage in useState initializer (runs exactly once —
  // React Strict Mode never double-invokes state initialisers, only effects).
  // Then call append directly in a useEffect with NO cleanup function so Strict
  // Mode's simulated unmount/remount cannot cancel the send.
  const appendRef = useRef(append);
  appendRef.current = append; // always keep fresh reference

  const [autoPrompt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null; // SSR safety
    try {
      const p = sessionStorage.getItem('ft_auto_prompt');
      if (p) sessionStorage.removeItem('ft_auto_prompt'); // consume immediately
      return p ?? null;
    } catch { return null; }
  });

  // Guard prevents the second Strict Mode effect run from re-sending
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!autoPrompt || autoSentRef.current) return;
    autoSentRef.current = true;
    // No timer, no cleanup fn → Strict Mode's cleanup phase has nothing to cancel
    appendRef.current({ role: 'user', content: autoPrompt });
  }, [autoPrompt]); // autoPrompt is stable (from useState); appendRef handled via ref

  const isEmpty = messages.length === 0 && !isLoading && !apiError;

  return (
    <>
      {/* Immersive gradient background */}
      <div className="scene-bg" aria-hidden="true" />

      <div className="chat-shell">
        {/* ── Sidebar ───────────────────────────────────────── */}
        <ItinerarySidebar
          itinerary={itinerary}
          onUpdate={setItinerary}
          onEditDay={handleEditDay}
          sidebarOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          ghostEnabled={ghostEnabled}
          onGhostToggle={handleGhostToggle}
        />

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Main column ───────────────────────────────────── */}
        <div className="chat-main">

          {/* Header */}
          <header className="chat-header">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(
                'p-2 rounded-xl transition-colors',
                sidebarOpen
                  ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                  : 'hover:bg-black/[.06] dark:hover:bg-white/[.08] text-muted-foreground hover:text-foreground'
              )}
              title="Trip itinerary (⌘/)"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-teal-800
                              flex items-center justify-center shadow-md shadow-teal-900/20">
                <Plane className="w-4 h-4 text-white" strokeWidth={1.8} />
              </div>
              <span className="font-bold text-sm text-foreground">
                Flexe<span className="text-teal-600 dark:text-teal-400">Travels</span>
              </span>
              <span className="hidden sm:inline text-xs text-muted-foreground border
                               border-border/60 rounded-full px-2.5 py-0.5">
                AI Planner
              </span>
            </div>

            <div className="flex-1" />

            {/* API error indicator */}
            {apiError && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-destructive
                              border border-destructive/30 bg-destructive/[.08] rounded-full px-2.5 py-1">
                <WifiOff className="w-3 h-3" />
                <span>API error</span>
              </div>
            )}

            <div className="flex items-center gap-0.5">
              {messages.length > 0 && (
                <button
                  onClick={() => {
                    setMessages([]); setItinerary(null); setApiError(null);
                    setCartFlight(null); setCartHotel(null); setShowCheckout(false);
                  }}
                  className="p-2 rounded-xl hover:bg-black/[.06] dark:hover:bg-white/[.08]
                             text-muted-foreground hover:text-foreground transition-colors"
                  title="New chat (⌘K)"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <ThemeToggle />
            </div>
          </header>

          {/* Messages */}
          <div ref={chatAreaRef} className="messages-area" onScroll={onScroll}>
            {isEmpty ? (
              <WelcomeScreen onSend={(msg) => append({ role: 'user', content: msg })} />
            ) : (
              <div className="messages-inner">
                {messages.map((msg, idx) => {
                  if (msg.role === 'user') {
                    return <ChatMessage key={msg.id} role="user" content={msg.content} />;
                  }
                  if (msg.role === 'assistant') {
                    const isLast     = idx === messages.length - 1;
                    const isStreaming = isLast && isLoading;
                    const toolCalls   = (msg as {
                      toolInvocations?: { toolName: string; state: string }[]
                    }).toolInvocations?.map(
                      (ti) => ({
                        toolName: ti.toolName,
                        state: (ti.state === 'result' ? 'result' : 'call') as 'call' | 'result',
                      })
                    ) ?? [];
                    return (
                      <ChatMessage
                        key={msg.id}
                        role="assistant"
                        content={msg.content}
                        streaming={isStreaming}
                        toolCalls={toolCalls}

                        onSelectFlight={handleSelectFlight}
                        onSelectHotel={handleSelectHotel}
                      />
                    );
                  }
                  return null;
                })}

                {isLoading && messages.at(-1)?.role === 'user' && <TypingIndicator />}
                {apiError && <ErrorBanner message={apiError} />}

                {/* ── Inline checkout card — appears after hotel is selected ── */}
                {showCheckout && (
                  <div className="my-4 px-2 sm:px-0">
                    <CheckoutCard
                      flight={cartFlight}
                      hotel={cartHotel}
                      onClose={handleCheckoutClose}
                      onConfirmed={handleCheckoutConfirmed}
                    />
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Scroll-to-bottom */}
          {showScrollBtn && (
            <div className="absolute bottom-28 right-5 z-20">
              <button
                onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-card/90 border border-border shadow-lg backdrop-blur-sm
                           text-xs text-muted-foreground hover:text-foreground transition-all"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                Scroll down
              </button>
            </div>
          )}

          {/* Input */}
          <InputBar
            input={input}
            isLoading={isLoading}
            onChange={(v) => handleInputChange({
              target: { value: v },
            } as React.ChangeEvent<HTMLInputElement>)}
            onSubmit={doSubmit}
            onStop={stop}
          />
        </div>
      </div>
    </>
  );
}
