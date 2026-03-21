'use client';

/**
 * FlightCard — Apple/boarding-pass inspired.
 * Large departure/arrival times are the hero. Everything else supports them.
 */

import Image from 'next/image';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { cn, formatPrice, formatTime, formatDate, airlineLogo } from '@/lib/utils';
import type { FlightResult } from '@/lib/types';

interface FlightCardProps {
  flight: FlightResult;
  onSelect?: (flight: FlightResult) => void;
  selected?: boolean;
  compact?: boolean;
}

// ── Airline logo — avs.io CDN with initials fallback ──────────────────────────
function AirlineLogo({ airline, iataCode }: { airline: string; iataCode?: string }) {
  const [errored, setErrored] = useState(false);
  const code     = (iataCode ?? '').slice(0, 2).toUpperCase();
  const initials = code || airline.slice(0, 2).toUpperCase();
  const src      = airlineLogo(code);

  if (!src || errored) {
    return (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center
                      bg-gradient-to-br from-teal-500/20 to-teal-600/30
                      dark:from-teal-400/15 dark:to-teal-500/25">
        <span className="text-[11px] font-black text-teal-700 dark:text-teal-300 tracking-tighter">
          {initials}
        </span>
      </div>
    );
  }

  return (
    <div className="w-9 h-9 rounded-xl overflow-hidden bg-white dark:bg-slate-800
                    flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10">
      <Image
        src={src}
        alt={airline}
        width={36}
        height={36}
        className="object-contain p-0.5"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

export function FlightCard({ flight, onSelect, selected, compact }: FlightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const stopLabel =
    flight.stops === 0 ? 'Non-stop'
    : flight.stops === 1 ? '1 stop'
    : `${flight.stops} stops`;

  const stopColor =
    flight.stops === 0 ? 'text-emerald-600 dark:text-emerald-400'
    : flight.stops === 1 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-500 dark:text-red-400';

  const stopBg =
    flight.stops === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20'
    : flight.stops === 1 ? 'bg-amber-50 dark:bg-amber-900/20'
    : 'bg-red-50 dark:bg-red-900/20';

  if (compact) {
    return (
      <div className={cn(
        'travel-card p-3 flex items-center gap-3',
        selected && 'ring-2 ring-teal-500 dark:ring-teal-400'
      )}>
        <AirlineLogo airline={flight.airline} iataCode={flight.segments?.[0]?.carrier} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{flight.origin} → {flight.destination}</div>
          <div className="text-xs text-muted-foreground">{formatTime(flight.departure)} · {flight.duration}</div>
        </div>
        <div className="text-sm font-bold">{formatPrice(flight.price, flight.currency)}</div>
      </div>
    );
  }

  return (
    <div className={cn(
      'travel-card overflow-hidden transition-all duration-200',
      selected && 'ring-2 ring-teal-500 dark:ring-teal-400 shadow-teal-500/10 shadow-lg'
    )}>
      {/* ── Top bar: airline + badges ─────────────────────────────────────── */}
      <div className="px-4 pt-3.5 pb-0 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AirlineLogo
            airline={flight.airline}
            iataCode={flight.segments?.[0]?.carrier ?? flight.airlineLogo}
          />
          <div>
            <p className="text-[13px] font-semibold text-foreground leading-none">{flight.airline}</p>
            {flight.provider && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 uppercase tracking-wide">
                via {flight.provider}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={cn(
            'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
            stopBg, stopColor
          )}>
            {stopLabel}
          </span>
          {flight.refundable && (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400
                             bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
              Refundable
            </span>
          )}
        </div>
      </div>

      {/* ── Hero: departure / animated path / arrival ─────────────────────── */}
      <div className="px-4 py-4 flex items-center gap-2">
        {/* Departure */}
        <div className="flex-shrink-0 text-left">
          <p className="text-2xl font-black text-foreground tracking-tight leading-none">
            {formatTime(flight.departure)}
          </p>
          <p className="text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
            {flight.origin}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {formatDate(flight.departure)}
          </p>
        </div>

        {/* Middle: duration label + path line */}
        <div className="flex-1 flex flex-col items-center justify-center px-2 min-w-0">
          <p className="text-[10px] text-muted-foreground mb-1 font-medium tracking-wide">
            {flight.duration}
          </p>
          <div className="relative w-full flex items-center">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px
                            bg-gradient-to-r from-teal-400/40 via-teal-500/70 to-teal-400/40" />
            <div className="relative z-10 w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
            <div className="flex-1 flex justify-center">
              {flight.stops === 0 ? (
                <svg className="w-4 h-4 text-teal-600 dark:text-teal-400 relative z-10 -rotate-45"
                     viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                </svg>
              ) : (
                <div className="flex items-center gap-2">
                  {flight.stopAirports?.slice(0, 2).map((ap, i) => (
                    <span key={i}
                      className="text-[9px] bg-amber-100 dark:bg-amber-900/30
                                 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-bold relative z-10">
                      {ap}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="relative z-10 w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
          </div>
        </div>

        {/* Arrival */}
        <div className="flex-shrink-0 text-right">
          <p className="text-2xl font-black text-foreground tracking-tight leading-none">
            {formatTime(flight.arrival)}
          </p>
          <p className="text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
            {flight.destination}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {formatDate(flight.arrival)}
          </p>
        </div>
      </div>

      {/* ── Price + CTA row ───────────────────────────────────────────────── */}
      <div className="mx-4 mb-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {flight.cabinClass?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'Economy'}
          {flight.baggage && <span> · {flight.baggage}</span>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xl font-black text-foreground leading-none">
              {formatPrice(flight.price, flight.currency)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">per person</p>
          </div>
          <button
            onClick={() => onSelect?.(flight)}
            className={cn(
              'px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-150 flex items-center gap-1.5',
              selected
                ? 'bg-teal-600 dark:bg-teal-500 text-white shadow-lg shadow-teal-500/25'
                : 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 active:scale-95'
            )}
          >
            {selected ? <><Check className="w-3.5 h-3.5" /> Selected</> : 'Select'}
          </button>
        </div>
      </div>

      {/* ── Expandable segment details ────────────────────────────────────── */}
      {flight.segments && flight.segments.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px]
                       text-muted-foreground hover:text-foreground border-t border-border/50
                       bg-muted/20 hover:bg-muted/40 transition-colors"
          >
            {expanded
              ? <><ChevronUp className="w-3 h-3" /> Hide flight details</>
              : <><ChevronDown className="w-3 h-3" /> Flight details</>}
          </button>

          {expanded && (
            <div className="px-4 py-3 space-y-3 bg-muted/15 border-t border-border/40">
              {flight.segments.map((seg, i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <div className="w-1 self-stretch rounded-full bg-teal-500/40 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">
                      {seg.origin} {'\u2192'} {seg.destination}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {formatDate(seg.departure)} · {formatTime(seg.departure)} {'\u2013'} {formatTime(seg.arrival)}
                    </p>
                    <p className="text-muted-foreground/70">
                      {seg.flightNumber} · {seg.duration}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
