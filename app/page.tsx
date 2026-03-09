'use client';

// ─── FlexeTravels Discovery Landing Page ──────────────────────────────────────
// Fetches from /api/discover daily and renders floating destination + event cards.
// Clicking any card navigates to /chat?q=... which auto-fires the chatbot prompt.

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Plane, Sparkles, ArrowRight, MapPin, Calendar,
  RefreshCw, TrendingUp, Music2, Compass,
} from 'lucide-react';
import type { DiscoverCard, DiscoverData } from './api/discover/route';

// ── Badge colour map ──────────────────────────────────────────────────────────
const BADGE_COLORS: Record<string, string> = {
  Trending:   'bg-rose-500',
  Hot:        'bg-orange-500',
  Popular:    'bg-violet-500',
  Concert:    'bg-pink-500',
  Festival:   'bg-yellow-500',
  Sports:     'bg-blue-500',
  F1:         'bg-red-600',
  'Grand Prix': 'bg-red-600',
  Adventure:  'bg-emerald-500',
  Wellness:   'bg-teal-500',
  Food:       'bg-amber-500',
  Culture:    'bg-indigo-500',
  Wildlife:   'bg-lime-600',
  Romance:    'bg-pink-400',
};
function badgeCls(badge?: string) {
  if (!badge) return 'bg-teal-500';
  return BADGE_COLORS[badge] ?? 'bg-teal-500';
}

// ── Portrait destination card ─────────────────────────────────────────────────
function DestCard({ card, onClick }: { card: DiscoverCard; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer bg-black
                 w-full aspect-[3/4]
                 shadow-[0_8px_32px_rgba(0,0,0,0.25)]
                 transition-all duration-500 ease-out
                 hover:-translate-y-2 hover:shadow-[0_28px_64px_rgba(0,0,0,0.45)]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
    >
      {/* Photo */}
      <Image
        src={card.image}
        alt={card.title}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
        unoptimized
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />

      {/* Top badges */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
        {card.badge && (
          <span className={`${badgeCls(card.badge)} text-white text-[10px] font-bold
                           px-2.5 py-1 rounded-full shadow-md`}>
            {card.badge}
          </span>
        )}
        {card.duration && (
          <span className="ml-auto bg-black/55 backdrop-blur-sm text-white/90 text-[10px]
                           font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" />
            {card.duration}
          </span>
        )}
      </div>

      {/* Bottom content */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p className="flex items-center gap-1 text-white/60 text-[10px] mb-1.5">
          <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
          {card.destination}, {card.country}
        </p>
        <h3 className="text-white font-bold text-sm leading-snug line-clamp-2 mb-1.5">
          {card.title}
        </h3>
        <p className="text-white/60 text-[10px] leading-relaxed line-clamp-2">
          {card.subtitle}
        </p>

        {/* Tags */}
        {card.tags.length > 0 && (
          <div className="flex gap-1.5 mt-2">
            {card.tags.slice(0, 2).map(tag => (
              <span key={tag}
                    className="bg-white/15 backdrop-blur-sm text-white/80 text-[9px]
                               font-medium px-2 py-0.5 rounded-full capitalize">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Hover CTA */}
        <div className="mt-2.5 flex items-center gap-1 text-teal-300 text-[10px] font-semibold
                        opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
                        transition-all duration-300">
          <Sparkles className="w-3 h-3" />
          Search flights &amp; hotels
          <ArrowRight className="w-2.5 h-2.5 ml-0.5" />
        </div>
      </div>
    </button>
  );
}

// ── Landscape event / experience card ────────────────────────────────────────
function WideCard({ card, onClick }: { card: DiscoverCard; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer bg-black
                 w-full aspect-video
                 shadow-[0_4px_24px_rgba(0,0,0,0.2)]
                 transition-all duration-500 ease-out
                 hover:-translate-y-1.5 hover:shadow-[0_20px_48px_rgba(0,0,0,0.4)]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
    >
      <Image
        src={card.image}
        alt={card.title}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105"
        unoptimized
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/30 to-transparent" />

      {/* Badge */}
      {card.badge && (
        <span className={`absolute top-3 left-3 ${badgeCls(card.badge)} text-white
                         text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md`}>
          {card.badge}
        </span>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p className="flex items-center gap-1 text-white/55 text-[10px] mb-1">
          <MapPin className="w-2.5 h-2.5" />
          {card.destination}, {card.country}
        </p>
        <h3 className="text-white font-bold text-sm leading-snug line-clamp-1">{card.title}</h3>
        <p className="text-white/55 text-[10px] mt-0.5 line-clamp-1">{card.subtitle}</p>

        <div className="mt-2 flex items-center gap-1 text-teal-300 text-[10px] font-semibold
                        opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
                        transition-all duration-300">
          Plan trip <ArrowRight className="w-2.5 h-2.5" />
        </div>
      </div>
    </button>
  );
}

// ── Skeleton cards ────────────────────────────────────────────────────────────
function SkeletonPortrait() {
  return (
    <div className="rounded-2xl bg-white/[0.06] animate-pulse w-full aspect-[3/4]" />
  );
}
function SkeletonLandscape() {
  return (
    <div className="rounded-2xl bg-white/[0.06] animate-pulse w-full aspect-video" />
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({
  icon, title, subtitle,
}: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="mt-0.5 w-8 h-8 rounded-xl bg-white/[0.07] border border-white/10
                      flex items-center justify-center flex-shrink-0 text-teal-400">
        {icon}
      </div>
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-white">{title}</h2>
        <p className="text-white/45 text-sm mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <nav className="relative z-20 flex items-center justify-between px-5 sm:px-8 py-5
                    max-w-7xl mx-auto">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-teal-800
                        flex items-center justify-center shadow-md shadow-teal-900/40">
          <Plane className="w-4 h-4 text-white" strokeWidth={1.8} />
        </div>
        <span className="font-bold text-white text-sm">
          Flexe<span className="text-teal-400">Travels</span>
        </span>
        <span className="hidden sm:inline text-[10px] text-white/40 border border-white/10
                         rounded-full px-2 py-0.5">
          AI Travel
        </span>
      </div>

      <Link
        href="/chat"
        className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold
                   bg-teal-500 hover:bg-teal-400 text-white
                   transition-all duration-200 shadow-lg shadow-teal-900/30
                   hover:shadow-teal-900/50 hover:-translate-y-px"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Plan a Trip
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </nav>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <div className="relative z-10 text-center pt-6 pb-14 px-6 max-w-3xl mx-auto">
      <div className="inline-flex items-center gap-2 bg-white/[0.07] border border-white/10
                      backdrop-blur-sm rounded-full px-4 py-1.5 text-white/60 text-xs mb-7">
        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
        Updated daily based on what travellers are booking
      </div>

      <h1 className="text-[2.5rem] sm:text-5xl md:text-[3.5rem] font-extrabold text-white
                     leading-[1.1] mb-5 tracking-tight">
        Where do you want
        <br />
        <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-400
                         bg-clip-text text-transparent">
          to go next?
        </span>
      </h1>

      <p className="text-white/55 text-base sm:text-lg max-w-xl mx-auto leading-relaxed mb-8">
        Click any card below — our AI instantly searches real flights &amp; hotels
        and builds your perfect itinerary.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-5 text-white/40 text-xs">
        <span className="flex items-center gap-1.5">
          <Plane className="w-3.5 h-3.5 text-teal-500" /> Real-time flight prices
        </span>
        <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:block" />
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-teal-500" /> Live hotel availability
        </span>
        <span className="w-1 h-1 rounded-full bg-white/20 hidden sm:block" />
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-teal-500" /> AI-built itineraries
        </span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const router  = useRouter();
  const [data,    setData]    = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch('/api/discover')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<DiscoverData>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { console.error('[discover]', err); setError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleClick = (prompt: string) => {
    // sessionStorage is more reliable than URL params across Next.js navigation caching
    try { sessionStorage.setItem('ft_auto_prompt', prompt); } catch { /* ignore if storage blocked */ }
    router.push('/chat');
  };

  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">

      {/* ── Background blobs ──────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full
                        bg-teal-600/15 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full
                        bg-purple-600/12 blur-[100px]" />
        <div className="absolute -bottom-40 left-1/4 w-[400px] h-[400px] rounded-full
                        bg-cyan-600/10 blur-[100px]" />
      </div>

      <Nav />
      <Hero />

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8">

        {/* Error / retry */}
        {error && !loading && (
          <div className="mb-8 flex items-center justify-center gap-3 text-white/50 text-sm">
            <span>Couldn&apos;t load trending data.</span>
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {/* ── Popular Destinations ──────────────────────────────────── */}
        <section className="mb-16">
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4" />}
            title="Popular Destinations"
            subtitle="What travellers are booking right now"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonPortrait key={i} />)
              : (data?.destinations ?? []).map(card => (
                  <DestCard key={card.id} card={card} onClick={() => handleClick(card.prompt)} />
                ))
            }
          </div>
        </section>

        {/* ── Trending Events ───────────────────────────────────────── */}
        <section className="mb-16">
          <SectionHeader
            icon={<Music2 className="w-4 h-4" />}
            title="Trending Events"
            subtitle="Concerts, festivals &amp; sports happening soon"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonLandscape key={i} />)
              : (data?.events ?? []).map(card => (
                  <WideCard key={card.id} card={card} onClick={() => handleClick(card.prompt)} />
                ))
            }
          </div>
        </section>

        {/* ── Trending Experiences ──────────────────────────────────── */}
        <section className="mb-20">
          <SectionHeader
            icon={<Compass className="w-4 h-4" />}
            title="Trending Experiences"
            subtitle="Adventures, wellness &amp; culture everyone&apos;s talking about"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonLandscape key={i} />)
              : (data?.experiences ?? []).map(card => (
                  <WideCard key={card.id} card={card} onClick={() => handleClick(card.prompt)} />
                ))
            }
          </div>
        </section>

        {/* ── Footer CTA ────────────────────────────────────────────── */}
        <div className="text-center pb-16">
          <p className="text-white/30 text-xs mb-6">
            Not sure where to go? Just ask our AI — describe your dream trip and we&apos;ll do the rest.
          </p>
          <Link
            href="/chat"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-base
                       bg-gradient-to-r from-teal-500 to-cyan-500
                       hover:from-teal-400 hover:to-cyan-400 text-white
                       shadow-[0_8px_32px_rgba(13,148,136,0.35)]
                       hover:shadow-[0_16px_48px_rgba(13,148,136,0.5)]
                       transition-all duration-300 hover:-translate-y-0.5"
          >
            <Sparkles className="w-5 h-5" />
            Chat with AI Travel Planner
            <ArrowRight className="w-4 h-4" />
          </Link>

          <p className="mt-6 text-white/20 text-[10px] max-w-lg mx-auto leading-relaxed">
            FlexeTravels is a technology platform, not a licensed travel agent (no IATA/CPBC).
            Flights processed via Duffel (IATA-accredited). Flat $20 service fee per booking.
          </p>
        </div>
      </div>
    </div>
  );
}
