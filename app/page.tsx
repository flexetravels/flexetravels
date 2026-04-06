'use client';

// ─── FlexeTravels — Premium Landing Page ─────────────────────────────────────
// Verified bookable destinations only (Duffel flights + LiteAPI hotels confirmed).
// Discover feed (trending events/experiences) loaded from /api/discover daily.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Plane, Sparkles, ArrowRight, MapPin, Calendar,
  RefreshCw, Music2, Compass, CheckCircle2,
  Zap, CreditCard, Shield, Users, TrendingUp,
  ChevronRight, Star, Clock,
} from 'lucide-react';
import { Nav } from '@/components/Nav';
import type { DiscoverCard, DiscoverData } from './api/discover/route';

// ─── Badge colour map ─────────────────────────────────────────────────────────
const BADGE_COLORS: Record<string, string> = {
  Trending: 'bg-rose-500', Hot: 'bg-orange-500', Popular: 'bg-violet-500',
  Concert: 'bg-pink-500', Festival: 'bg-yellow-500', Sports: 'bg-blue-500',
  F1: 'bg-red-600', 'Grand Prix': 'bg-red-600', Adventure: 'bg-emerald-500',
  Wellness: 'bg-teal-500', Food: 'bg-amber-500', Culture: 'bg-indigo-500',
  Wildlife: 'bg-lime-600', Romance: 'bg-pink-400',
};
const badgeCls = (badge?: string) => BADGE_COLORS[badge ?? ''] ?? 'bg-teal-500';

// ─── Verified end-to-end bookable destinations ────────────────────────────────
// Each confirmed: Duffel flights from major CA airports + LiteAPI hotel inventory.
const VERIFIED = [
  {
    city: 'Cancún', country: 'Mexico', tag: 'Beach & Sun', tagColor: 'bg-sky-500',
    flightFrom: 'Toronto', flightHrs: '4h 30m',
    bestFor: 'Beaches · Resorts · Nightlife',
    img: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day beach vacation to Cancún Mexico for 2 adults flying from Toronto. I want a great resort with pool access.',
  },
  {
    city: 'New York City', country: 'United States', tag: 'City Break', tagColor: 'bg-violet-500',
    flightFrom: 'Toronto', flightHrs: '1h 30m',
    bestFor: 'Culture · Food · Shopping',
    img: 'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 5 day New York City trip for 2 adults flying from Toronto. Mix of culture, great restaurants, and iconic sights.',
  },
  {
    city: 'Punta Cana', country: 'Dominican Republic', tag: 'All-Inclusive', tagColor: 'bg-amber-500',
    flightFrom: 'Toronto', flightHrs: '4h 45m',
    bestFor: 'All-Inclusive · Beach · Couples',
    img: 'https://images.unsplash.com/photo-1584553421349-3557471bed79?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day all-inclusive beach vacation to Punta Cana Dominican Republic for 2 adults flying from Toronto. We want a luxury beach resort.',
  },
  {
    city: 'Dubai', country: 'UAE', tag: 'Luxury', tagColor: 'bg-yellow-500',
    flightFrom: 'Toronto', flightHrs: '13h 30m',
    bestFor: 'Luxury · Shopping · Architecture',
    img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 6 day luxury trip to Dubai UAE for 2 adults flying from Toronto. We want a 5-star hotel, iconic experiences, and great food.',
  },
  {
    city: 'Barcelona', country: 'Spain', tag: 'Culture', tagColor: 'bg-indigo-500',
    flightFrom: 'Montreal', flightHrs: '7h 45m',
    bestFor: 'Architecture · Food · Beaches',
    img: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day food and culture trip to Barcelona Spain for 2 adults flying from Montreal. We love architecture, tapas, and beach walks.',
  },
  {
    city: 'Tokyo', country: 'Japan', tag: 'Culture', tagColor: 'bg-rose-500',
    flightFrom: 'Vancouver', flightHrs: '10h',
    bestFor: 'Culture · Food · Temples',
    img: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 10 day cultural trip to Tokyo Japan for 2 adults flying from Vancouver. We want to experience temples, street food, and city life.',
  },
  {
    city: 'Bali', country: 'Indonesia', tag: 'Wellness', tagColor: 'bg-teal-500',
    flightFrom: 'Toronto', flightHrs: '~20h',
    bestFor: 'Wellness · Temples · Rice Fields',
    img: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 10 day wellness and relaxation trip to Bali Indonesia for 2 adults departing Toronto. We want spa days, yoga, rice terraces, and beautiful villas.',
  },
  {
    city: 'Paris', country: 'France', tag: 'Romance', tagColor: 'bg-pink-500',
    flightFrom: 'Toronto', flightHrs: '8h',
    bestFor: 'Romance · Art · Cuisine',
    img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day romantic trip to Paris France for 2 adults flying from Toronto. We want a boutique hotel near the Eiffel Tower, great food, and romantic experiences.',
  },
  {
    city: 'Miami', country: 'United States', tag: 'Beach', tagColor: 'bg-orange-500',
    flightFrom: 'Toronto', flightHrs: '3h 15m',
    bestFor: 'Beach · Art Deco · Nightlife',
    img: 'https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 5 day Miami beach trip for 2 adults flying from Toronto. We want a great South Beach hotel, pool time, and the best restaurants.',
  },
  {
    city: 'London', country: 'United Kingdom', tag: 'City Break', tagColor: 'bg-blue-500',
    flightFrom: 'Toronto', flightHrs: '7h 30m',
    bestFor: 'History · Theatre · Pubs',
    img: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 6 day trip to London UK for 2 adults flying from Toronto. We love history, world-class museums, West End shows, and great pubs.',
  },
  {
    city: 'Rome', country: 'Italy', tag: 'History', tagColor: 'bg-amber-600',
    flightFrom: 'Toronto', flightHrs: '9h 30m',
    bestFor: 'History · Food · Art',
    img: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day food and history trip to Rome Italy for 2 adults flying from Toronto. We want incredible pasta, ancient ruins, and a charming hotel.',
  },
  {
    city: 'Lisbon', country: 'Portugal', tag: 'Trending', tagColor: 'bg-emerald-500',
    flightFrom: 'Montreal', flightHrs: '7h 15m',
    bestFor: 'Tiles · Seafood · Trams',
    img: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&h=800&fit=crop&q=85',
    prompt: 'Plan a 7 day trip to Lisbon Portugal for 2 adults flying from Montreal. We want colourful neighbourhoods, seafood, fado music, and a boutique hotel.',
  },
] as const;

// ─── Discover card components ─────────────────────────────────────────────────
function WideCard({ card, onClick }: { card: DiscoverCard; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer bg-black w-full aspect-video
                 shadow-[0_4px_24px_rgba(0,0,0,0.2)] transition-all duration-500 ease-out
                 hover:-translate-y-1.5 hover:shadow-[0_20px_48px_rgba(0,0,0,0.4)]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
      <Image src={card.image} alt={card.title} fill unoptimized
        sizes="(max-width:640px) 100vw,(max-width:1024px) 50vw,25vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/30 to-transparent" />
      {card.badge && (
        <span className={`absolute top-3 left-3 ${badgeCls(card.badge)} text-white
                         text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md`}>
          {card.badge}
        </span>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p className="flex items-center gap-1 text-white/55 text-[10px] mb-1">
          <MapPin className="w-2.5 h-2.5" />{card.destination}, {card.country}
        </p>
        <h3 className="text-white font-bold text-sm leading-snug line-clamp-1">{card.title}</h3>
        <div className="mt-2 flex items-center gap-1 text-teal-300 text-[10px] font-semibold
                        opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
                        transition-all duration-300">
          Plan trip <ArrowRight className="w-2.5 h-2.5" />
        </div>
      </div>
    </button>
  );
}

function PortraitCard({ card, onClick }: { card: DiscoverCard; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer bg-black w-full aspect-[3/4]
                 shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-500 ease-out
                 hover:-translate-y-2 hover:shadow-[0_28px_64px_rgba(0,0,0,0.45)]
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
      <Image src={card.image} alt={card.title} fill unoptimized
        sizes="(max-width:640px) 50vw,(max-width:1024px) 33vw,20vw"
        className="object-cover transition-transform duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
        {card.badge && (
          <span className={`${badgeCls(card.badge)} text-white text-[10px] font-bold px-2.5 py-1 rounded-full`}>
            {card.badge}
          </span>
        )}
        {card.duration && (
          <span className="ml-auto bg-black/55 backdrop-blur-sm text-white/90 text-[10px]
                           font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" />{card.duration}
          </span>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p className="flex items-center gap-1 text-white/60 text-[10px] mb-1.5">
          <MapPin className="w-2.5 h-2.5 flex-shrink-0" />{card.destination}, {card.country}
        </p>
        <h3 className="text-white font-bold text-sm leading-snug line-clamp-2 mb-1.5">{card.title}</h3>
        <div className="mt-2 flex items-center gap-1 text-teal-300 text-[10px] font-semibold
                        opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
                        transition-all duration-300">
          <Sparkles className="w-3 h-3" />Search &amp; book <ArrowRight className="w-2.5 h-2.5" />
        </div>
      </div>
    </button>
  );
}

const SkeletonPortrait = () => <div className="rounded-2xl bg-white/[0.06] animate-pulse w-full aspect-[3/4]" />;
const SkeletonWide = () => <div className="rounded-2xl bg-white/[0.06] animate-pulse w-full aspect-video" />;

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-8 flex items-start gap-3">
      <div className="mt-0.5 w-9 h-9 rounded-xl bg-white/[0.07] border border-white/10
                      flex items-center justify-center flex-shrink-0 text-teal-400">{icon}</div>
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white">{title}</h2>
        <p className="text-white/45 text-sm mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ onPrompt }: { onPrompt: (p: string) => void }) {
  const [imgIdx, setImgIdx] = useState(0);
  const IMGS = [
    { src: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&h=1100&fit=crop&q=90', label: 'Bali, Indonesia' },
    { src: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&h=1100&fit=crop&q=90', label: 'Paris, France' },
    { src: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&h=1100&fit=crop&q=90', label: 'Dubai, UAE' },
    { src: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&h=1100&fit=crop&q=90', label: 'Tokyo, Japan' },
  ];
  useEffect(() => {
    const t = setInterval(() => setImgIdx(i => (i + 1) % IMGS.length), 4500);
    return () => clearInterval(t);
  }, [IMGS.length]);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Deep dark BG */}
      <div className="absolute inset-0 bg-[#060a10]" />

      {/* Ambient colour blobs */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute -top-40 left-0 w-[700px] h-[700px] rounded-full bg-teal-700/10 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-cyan-600/8 blur-[110px]" />
        <div className="absolute bottom-0 left-1/3 w-[400px] h-[400px] rounded-full bg-purple-700/6 blur-[90px]" />
      </div>

      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-[0.025] pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
        backgroundSize: '64px 64px',
      }} />

      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 w-full
                      pt-28 pb-20 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

        {/* ── Left copy ── */}
        <div>
          <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/25
                          rounded-full px-4 py-1.5 text-teal-300 text-xs font-semibold mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            Revolutionising how the world books travel
          </div>

          <h1 className="text-[2rem] sm:text-5xl md:text-6xl xl:text-[4.25rem] font-extrabold
                         text-white leading-[1.08] tracking-tight mb-5">
            Book your entire trip.
            <br />
            <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-500
                             bg-clip-text text-transparent">
              In one conversation.
            </span>
          </h1>

          <p className="text-white/55 text-base sm:text-xl max-w-[500px] leading-relaxed mb-8">
            Tell our AI what you&apos;re dreaming of. It searches real flights and hotels in seconds —
            then books and pays for everything right here.
            No tabs. No redirects. No OTA markups.
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-8">
            <Link href="/chat"
              className="flex items-center justify-center gap-2.5 px-7 py-4 rounded-2xl text-base font-bold
                         bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                         shadow-[0_8px_36px_rgba(13,148,136,0.45)]
                         hover:shadow-[0_16px_56px_rgba(13,148,136,0.6)]
                         hover:from-teal-400 hover:to-cyan-400
                         transition-all duration-300 hover:-translate-y-0.5 touch-manipulation">
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              Start planning free
              <ArrowRight className="w-4 h-4 flex-shrink-0" />
            </Link>
            <button
              onClick={() => onPrompt('Inspire me — what are the most exciting trips to book right now? I\'m open on destination, flexible on dates, budget around $3,000 for 2 adults.')}
              className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl text-sm font-semibold
                         border border-white/15 text-white/65 hover:text-white hover:border-white/30
                         bg-white/[0.04] hover:bg-white/[0.07] transition-all duration-200 touch-manipulation">
              Inspire me <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Trust row */}
          <div className="flex flex-wrap gap-5">
            {[
              { icon: <CheckCircle2 className="w-4 h-4 text-teal-400" />, txt: 'Real confirmed bookings' },
              { icon: <CreditCard className="w-4 h-4 text-teal-400" />, txt: '$20 flat fee, no extras' },
              { icon: <Shield className="w-4 h-4 text-teal-400" />, txt: 'Secured by Stripe' },
            ].map(t => (
              <span key={t.txt} className="flex items-center gap-1.5 text-white/45 text-xs">
                {t.icon}{t.txt}
              </span>
            ))}
          </div>
        </div>

        {/* ── Right: Rotating cinematic photo with floating UI cards ── */}
        <div className="relative hidden lg:flex items-center justify-center">
          {/* Main photo */}
          <div className="relative w-[400px] h-[540px] rounded-[2rem] overflow-hidden
                          shadow-[0_40px_100px_rgba(0,0,0,0.65)] ring-1 ring-white/10">
            {IMGS.map((img, i) => (
              <div key={img.src}
                className={`absolute inset-0 transition-opacity duration-[1200ms] ${i === imgIdx ? 'opacity-100' : 'opacity-0'}`}>
                <Image src={img.src} alt={img.label} fill className="object-cover" unoptimized />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                <div className="absolute bottom-5 left-5 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-teal-300" />
                  <span className="text-white font-bold text-sm">{img.label}</span>
                </div>
              </div>
            ))}
            {/* Dot controls */}
            <div className="absolute top-4 right-4 flex gap-1.5">
              {IMGS.map((_, i) => (
                <button key={i} onClick={() => setImgIdx(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === imgIdx ? 'w-5 bg-teal-400' : 'w-1.5 bg-white/40'}`} />
              ))}
            </div>
          </div>

          {/* Floating AI bubble */}
          <div className="absolute -left-10 top-14 max-w-[230px]
                          bg-[#0d1e2e]/95 backdrop-blur-md border border-teal-500/30
                          rounded-2xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-teal-700
                              flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-white text-[11px] font-bold">FlexeTravels AI</span>
            </div>
            <p className="text-white/65 text-[11px] leading-relaxed">
              &ldquo;Found 3 non-stop flights from $489 and 5 hotels from $142/night. Want me to lock in the best combo?&rdquo;
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <span className="bg-teal-500/20 border border-teal-500/30 text-teal-300
                               text-[9px] font-bold px-2 py-0.5 rounded-full">✈ Bookable</span>
              <span className="bg-white/8 border border-white/10 text-white/50
                               text-[9px] font-medium px-2 py-0.5 rounded-full">🏨 Live rates</span>
            </div>
          </div>

          {/* Floating booking confirmed card */}
          <div className="absolute -right-8 bottom-24
                          bg-[#0d1e2e]/95 backdrop-blur-md border border-white/10
                          rounded-2xl px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-white/35 text-[10px] font-medium">Booking confirmed</p>
            </div>
            <p className="text-white font-bold text-sm">Bali — 10 nights</p>
            <div className="mt-1.5 flex items-center gap-1">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
              ))}
              <span className="text-white/40 text-[10px] ml-1">5-star villa</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2
                      text-white/25 pointer-events-none">
        <span className="text-[10px] font-semibold tracking-[0.2em] uppercase">Scroll</span>
        <div className="w-px h-10 bg-gradient-to-b from-white/25 to-transparent" />
      </div>
    </section>
  );
}

// ─── Stats ribbon ──────────────────────────────────────────────────────────────
function StatsRibbon() {
  return (
    <div className="relative z-10 border-y border-white/[0.06] bg-white/[0.02]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-7">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
          {[
            { val: '200+',  lbl: 'Airlines worldwide',      icon: <Plane className="w-5 h-5" /> },
            { val: '1M+',   lbl: 'Hotels worldwide',        icon: <MapPin className="w-5 h-5" /> },
            { val: '3 AIs', lbl: 'Working in parallel',     icon: <Sparkles className="w-5 h-5" /> },
            { val: '$20',   lbl: 'Flat fee, every booking', icon: <CreditCard className="w-5 h-5" /> },
          ].map(s => (
            <div key={s.lbl} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20
                              flex items-center justify-center text-teal-400 flex-shrink-0">
                {s.icon}
              </div>
              <div>
                <p className="text-white font-extrabold text-xl sm:text-2xl leading-none">{s.val}</p>
                <p className="text-white/40 text-xs mt-0.5">{s.lbl}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── How it works ──────────────────────────────────────────────────────────────
function HowItWorks() {
  return (
    <section className="relative z-10 py-24 px-5 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">How it works</p>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
            Dream to booked
            <span className="text-white/30"> in under 5 minutes.</span>
          </h2>
          <p className="text-white/40 text-lg max-w-lg mx-auto">
            No switching tabs, no copying flight codes, no calling anyone.
            Search, select, and pay in one chat window.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { n: '01', grad: 'from-teal-500 to-cyan-500', icon: <Sparkles className="w-6 h-6 text-white" />,
              title: 'Describe your vibe', desc: 'Tell the AI what kind of trip you\'re dreaming of — no forms, just conversation.' },
            { n: '02', grad: 'from-violet-500 to-purple-500', icon: <Zap className="w-6 h-6 text-white" />,
              title: 'AI searches everything', desc: '3 AIs fan out in parallel — real confirmed flights, live hotel rates, local experiences. Results in seconds.' },
            { n: '03', grad: 'from-amber-500 to-orange-500', icon: <Star className="w-6 h-6 text-white" />,
              title: 'Pick your favourites', desc: 'Browse rich flight and hotel cards. The AI remembers your preferences throughout.' },
            { n: '04', grad: 'from-rose-500 to-pink-500', icon: <CheckCircle2 className="w-6 h-6 text-white" />,
              title: 'Book & pay in-app', desc: 'Enter passenger details and pay securely. Confirmed booking references returned immediately.' },
          ].map((s, i) => (
            <div key={s.n} className="relative bg-white/[0.035] border border-white/[0.07] rounded-2xl p-6
                                       hover:bg-white/[0.055] hover:border-white/[0.13] transition-all duration-300">
              <span className="absolute top-4 right-4 text-[3rem] font-extrabold text-white/[0.035]
                               leading-none select-none">{s.n}</span>
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.grad}
                              flex items-center justify-center mb-5 shadow-lg`}>{s.icon}</div>
              <h3 className="text-white font-bold text-lg mb-2">{s.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed">{s.desc}</p>
              {i < 3 && (
                <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                  <ChevronRight className="w-5 h-5 text-white/20" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Why different ─────────────────────────────────────────────────────────────
function WhyDifferent() {
  return (
    <section className="relative z-10 py-20 px-5 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start mb-12">
          <div className="lg:w-1/2">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Why FlexeTravels</p>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.08]">
              We didn&apos;t build a
              <br />search engine.
              <br /><span className="bg-gradient-to-r from-teal-400 to-cyan-300 bg-clip-text text-transparent">
                We built a travel agent.
              </span>
            </h2>
          </div>
          <div className="lg:w-1/2 lg:pt-3">
            <p className="text-white/50 text-lg leading-relaxed">
              Kayak searches. Google compares. Layla links. FlexeTravels{' '}
              <strong className="text-white font-bold">books</strong>. We process confirmed
              flight and hotel reservations — not referral links — directly and securely,
              right here in one conversation.
            </p>
            <Link href="/chat"
              className="inline-flex items-center gap-2 mt-6 text-teal-400 font-semibold text-sm
                         hover:text-teal-300 transition-colors group">
              Experience the difference
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { col: 'text-teal-400 bg-teal-400/10 border-teal-400/20', icon: <CheckCircle2 className="w-6 h-6" />,
              title: 'Real bookings, not referrals',
              desc: 'Most AI travel tools give you links and send you to Booking.com. We process the booking — flight confirmation, hotel voucher — right here in the chat.' },
            { col: 'text-violet-400 bg-violet-400/10 border-violet-400/20', icon: <Zap className="w-6 h-6" />,
              title: 'Three AIs, one answer',
              desc: 'Our multi-model AI fan-out searches everything at once — flight pricing, destination guides, experience recommendations. Three specialists, one conversation.' },
            { col: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: <CreditCard className="w-6 h-6" />,
              title: 'One flat fee. Always.',
              desc: 'We charge a flat $20 service fee per booking. No commissions inflating hotel prices, no per-passenger fees. What you see is what you pay.' },
            { col: 'text-rose-400 bg-rose-400/10 border-rose-400/20', icon: <Clock className="w-6 h-6" />,
              title: 'Minutes, not hours',
              desc: 'Traditional agents take days. OTAs make you switch tabs endlessly. FlexeTravels goes from "I want to go to Bali" to confirmed booking in minutes.' },
          ].map(p => (
            <div key={p.title} className="flex gap-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6
                                           hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-300">
              <div className={`w-12 h-12 rounded-xl border flex items-center justify-center flex-shrink-0 ${p.col}`}>
                {p.icon}
              </div>
              <div>
                <h3 className="text-white font-bold text-base mb-1.5">{p.title}</h3>
                <p className="text-white/45 text-sm leading-relaxed">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Social proof / Testimonials ────────────────────────────────────────────────
function Testimonials() {
  const quotes = [
    { text: 'Booked our Cancun trip in 5 minutes — flights, hotel, everything. My wife couldn\'t believe it.',
      name: 'James T.', role: 'Family of 4', avatar: 'JT' },
    { text: 'The AI found us a boutique hotel in Lisbon that was cheaper than anything on Booking.com. Game changer.',
      name: 'Sarah M.', role: 'Couple', avatar: 'SM' },
    { text: 'I normally spend hours comparing tabs. This did it all in one conversation. Worth every penny of the $20 fee.',
      name: 'David K.', role: 'Solo traveler', avatar: 'DK' },
  ];

  return (
    <section className="relative z-10 py-20 px-5 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Loved by travelers</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            What our early users are saying
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {quotes.map(q => (
            <div key={q.name}
              className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6
                         hover:bg-white/[0.06] hover:border-white/[0.14] transition-all duration-300">
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="text-white/70 text-sm leading-relaxed mb-5">&ldquo;{q.text}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-500 to-teal-700
                                flex items-center justify-center text-white text-xs font-bold">
                  {q.avatar}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{q.name}</p>
                  <p className="text-white/35 text-xs">{q.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Verified destinations ─────────────────────────────────────────────────────
function VerifiedDestinations({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <section className="relative z-10 py-20 px-5 sm:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">Book today</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
              End-to-end bookable destinations
            </h2>
            <p className="text-white/35 text-sm mt-2 max-w-lg">
              Every card below is verified — Duffel flights confirmed from major Canadian airports,
              LiteAPI hotel inventory confirmed. Click any card to start your booking.
            </p>
          </div>
          <Link href="/chat"
            className="flex-shrink-0 flex items-center gap-2 text-sm font-semibold text-teal-400
                       hover:text-teal-300 transition-colors group whitespace-nowrap">
            Any destination <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {VERIFIED.map(d => (
            <button key={d.city} type="button" onClick={() => onPrompt(d.prompt)}
              className="group relative rounded-2xl overflow-hidden bg-black text-left
                         shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all duration-500
                         hover:-translate-y-2 hover:shadow-[0_24px_72px_rgba(0,0,0,0.6)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
              {/* Photo */}
              <div className="relative w-full aspect-[3/4]">
                <Image src={d.img} alt={d.city} fill unoptimized
                  sizes="(max-width:640px) 50vw,(max-width:1024px) 33vw,25vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/30 to-black/5" />

                {/* Verified badge */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[9px] font-bold
                                text-white bg-teal-500/90 backdrop-blur-sm px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-2.5 h-2.5" />Bookable
                </div>

                {/* Category tag */}
                <span className={`absolute top-2.5 right-2.5 ${d.tagColor} text-white
                                 text-[9px] font-bold px-2 py-0.5 rounded-full`}>{d.tag}</span>

                {/* Content */}
                <div className="absolute bottom-0 left-0 right-0 p-3.5">
                  <h3 className="text-white font-extrabold text-[15px] leading-tight">{d.city}</h3>
                  <p className="text-white/45 text-[11px] mb-2.5">{d.country}</p>

                  {/* Meta chips */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="flex items-center gap-1 text-white/55 text-[10px]
                                     bg-white/10 px-2 py-0.5 rounded-full">
                      <Plane className="w-2.5 h-2.5" />{d.flightHrs}
                    </span>
                    <span className="flex items-center gap-1 text-white/55 text-[10px]
                                     bg-white/10 px-2 py-0.5 rounded-full">
                      <Users className="w-2.5 h-2.5" />from {d.flightFrom}
                    </span>
                  </div>

                  {/* Hover CTA button */}
                  <div className="flex items-center justify-between
                                  border border-white/15 group-hover:border-teal-500
                                  group-hover:bg-teal-500 rounded-xl px-3 py-2
                                  transition-all duration-300">
                    <span className="text-white/55 group-hover:text-white text-[11px] font-bold transition-colors">
                      Search flights &amp; hotels
                    </span>
                    <ArrowRight className="w-3 h-3 text-white/35 group-hover:text-white
                                           group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Trust strip (security + booking guarantees) ───────────────────────────────
function TrustStrip() {
  return (
    <div className="relative z-10 border-t border-white/[0.05] py-10 px-5 sm:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {[
            { icon: <Shield className="w-4 h-4" />,       text: 'Secure checkout'         },
            { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Confirmed bookings only'  },
            { icon: <CreditCard className="w-4 h-4" />,   text: '$20 flat fee, no extras'  },
            { icon: <Zap className="w-4 h-4" />,          text: 'Results in seconds'       },
            { icon: <Users className="w-4 h-4" />,        text: 'No account required'      },
          ].map(t => (
            <div key={t.text} className="flex items-center gap-2 text-white/30 text-xs font-medium">
              <span className="text-teal-500/70">{t.icon}</span>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const router  = useRouter();
  const [data, setData]       = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const loadedRef             = useRef(false);

  const loadDiscover = useCallback(() => {
    setLoading(true); setError(false);
    fetch('/api/discover')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<DiscoverData>; })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadDiscover();
  }, [loadDiscover]);

  const handlePrompt = useCallback((prompt: string) => {
    try { sessionStorage.setItem('ft_auto_prompt', prompt); } catch { /* ignore */ }
    router.push('/chat');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">
      <Nav />
      <Hero onPrompt={handlePrompt} />
      <StatsRibbon />
      <HowItWorks />
      <WhyDifferent />
      <Testimonials />
      <VerifiedDestinations onPrompt={handlePrompt} />
      <TrustStrip />

      {/* ── AI-curated trending discover feed ──────────────────────────── */}
      <div className="relative z-10 border-t border-white/[0.05] pt-20 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto">

          {error && !loading && (
            <div className="mb-8 flex items-center justify-center gap-3 text-white/50 text-sm">
              <span>Couldn&apos;t load trending data.</span>
              <button onClick={loadDiscover}
                className="flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-medium">
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          )}

          <section className="mb-16">
            <SectionHeader icon={<TrendingUp className="w-4 h-4" />}
              title="Trending Right Now" subtitle="What travellers are booking this week" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {loading ? Array.from({ length: 6 }).map((_, i) => <SkeletonPortrait key={i} />)
                : (data?.destinations ?? []).map(c => <PortraitCard key={c.id} card={c} onClick={() => handlePrompt(c.prompt)} />)}
            </div>
          </section>

          <section className="mb-16">
            <SectionHeader icon={<Music2 className="w-4 h-4" />}
              title="Events Worth Flying For" subtitle="Concerts, festivals &amp; sports happening soon" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonWide key={i} />)
                : (data?.events ?? []).map(c => <WideCard key={c.id} card={c} onClick={() => handlePrompt(c.prompt)} />)}
            </div>
          </section>

          <section className="mb-16">
            <SectionHeader icon={<Compass className="w-4 h-4" />}
              title="Experiences Worth Booking" subtitle="Adventures, wellness &amp; culture everyone&apos;s talking about" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonWide key={i} />)
                : (data?.experiences ?? []).map(c => <WideCard key={c.id} card={c} onClick={() => handlePrompt(c.prompt)} />)}
            </div>
          </section>
        </div>
      </div>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="relative z-10 py-24 px-5 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden border border-teal-500/20
                          bg-gradient-to-br from-teal-600/25 via-[#0d1f2e] to-[#070b12]
                          shadow-[0_40px_100px_rgba(13,148,136,0.12)] p-10 sm:p-16 text-center">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72
                            rounded-full bg-teal-500/12 blur-[90px] pointer-events-none" />
            <div className="relative">
              <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Ready to go?</p>
              <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
                Your next adventure is
                <br /><span className="bg-gradient-to-r from-teal-400 to-cyan-300 bg-clip-text text-transparent">
                  one conversation away.
                </span>
              </h2>
              <p className="text-white/45 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
                Join thousands of smart travellers who&apos;ve replaced hours of tab-switching with a single
                AI-powered chat. Free to start — flat $20 when you book.
              </p>
              <Link href="/chat"
                className="inline-flex items-center gap-3 px-10 py-4 rounded-2xl font-bold text-lg
                           bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                           shadow-[0_8px_40px_rgba(13,148,136,0.45)]
                           hover:shadow-[0_20px_64px_rgba(13,148,136,0.6)]
                           hover:from-teal-400 hover:to-cyan-400
                           transition-all duration-300 hover:-translate-y-1">
                <Sparkles className="w-5 h-5" />
                Start planning for free
                <ArrowRight className="w-5 h-5" />
              </Link>
              <p className="mt-5 text-white/22 text-xs">
                No account needed · Book in minutes · $20 flat service fee per booking
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.05] py-12 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8 mb-10">
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-teal-800
                              flex items-center justify-center">
                <Plane className="w-4 h-4 text-white" strokeWidth={1.8} />
              </div>
              <span className="font-bold text-white/75 text-base">
                Flexe<span className="text-teal-400">Travels</span>
              </span>
            </div>

            {/* Nav links */}
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              {[
                { href: '/how-it-works', label: 'How It Works' },
                { href: '/about',        label: 'About' },
                { href: '/partners',     label: 'For Partners' },
                { href: '/chat',         label: 'Start Planning' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="text-white/35 hover:text-white/75 text-sm transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="border-t border-white/[0.05] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-white/18 text-[10px] max-w-2xl leading-relaxed text-center sm:text-left">
              FlexeTravels is a technology platform, not a licensed travel agent (no IATA/CPBC).
              Flights processed via Duffel (IATA-accredited). Flat $20 service fee per booking.
              Always verify prices before payment.
            </p>
            <p className="text-white/18 text-[10px] flex-shrink-0">
              © {new Date().getFullYear()} FlexeTravels
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
