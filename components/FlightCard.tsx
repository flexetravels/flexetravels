'use client';

import Image from 'next/image';
import { Plane, Clock, ArrowRight, ChevronDown, ChevronUp, Luggage } from 'lucide-react';
import { useState } from 'react';
import { cn, formatPrice, formatTime, formatDate, airlineLogo } from '@/lib/utils';
import type { FlightResult } from '@/lib/types';

interface FlightCardProps {
  flight: FlightResult;
  onSelect?: (flight: FlightResult) => void;
  selected?: boolean;
  compact?: boolean;
}

// ── Airline logo with safe fallback ───────────────────────────────────────────
// Uses || (not ??) so empty strings fall through to the icon fallback.
function AirlineLogo({ airline, logoUrl }: { airline: string; logoUrl?: string }) {
  const src = logoUrl || airlineLogo(airline);
  if (!src) return <Plane className="w-5 h-5 text-muted-foreground" />;

  return (
    <Image
      src={src}
      alt={airline}
      width={32}
      height={32}
      className="object-contain"
      onError={(e) => {
        // Replace broken image with the plane icon fallback
        const el = e.target as HTMLImageElement;
        el.style.display = 'none';
        const icon = document.createElement('span');
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4c-1 0-2 1-3.5 2.5L11 10 2.8 6.2c-.5-.2-1.1 0-1.4.5l-.3.5a1 1 0 0 0 .1 1.2L6 11l-2 3H1l-1 1 3 2 2 3 1-1v-3l3-2 3.5 4.8a1 1 0 0 0 1.2.1l.5-.3c.5-.3.7-.9.5-1.4z"/></svg>`;
        el.parentElement?.appendChild(icon);
      }}
    />
  );
}

export function FlightCard({ flight, onSelect, selected, compact }: FlightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const stopLabel =
    flight.stops === 0 ? 'Non-stop'
    : flight.stops === 1 ? '1 stop'
    : `${flight.stops} stops`;

  const stopColor =
    flight.stops === 0 ? 'text-teal-600 dark:text-teal-400'
    : flight.stops === 1 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-500';

  return (
    <div
      className={cn(
        'travel-card overflow-hidden transition-all duration-200',
        selected && 'ring-2 ring-teal-600 dark:ring-teal-400',
        compact ? 'text-xs' : 'text-sm'
      )}
    >
      {/* Main row */}
      <div className="p-4 flex items-center gap-3">
        {/* Airline logo */}
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-50 dark:bg-navy-700 flex items-center justify-center overflow-hidden border border-border">
          <AirlineLogo airline={flight.airline} logoUrl={flight.airlineLogo} />
        </div>

        {/* Route + times */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <span className="text-base">{flight.origin}</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-base">{flight.destination}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground mt-0.5">
            <span>{formatTime(flight.departure)}</span>
            <span className="text-xs">→</span>
            <span>{formatTime(flight.arrival)}</span>
            <span className="text-xs">·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {flight.duration}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span>{flight.airline}</span>
            {flight.baggage && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Luggage className="w-3 h-3" />
                  {flight.baggage}
                </span>
              </>
            )}
            {flight.provider && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-muted-foreground capitalize font-medium">
                via {flight.provider}
              </span>
            )}
          </div>
        </div>

        {/* Price + CTA */}
        <div className="flex-shrink-0 text-right">
          <div className="text-lg font-bold text-foreground">
            {formatPrice(flight.price, flight.currency)}
          </div>
          <div className={cn('text-xs font-medium', stopColor)}>{stopLabel}</div>
          {!compact && (
            <button
              onClick={() => onSelect?.(flight)}
              className={cn(
                'mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150',
                selected
                  ? 'bg-teal-600 text-white dark:bg-teal-500'
                  : 'bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50'
              )}
            >
              {selected ? '✓ Selected' : 'Select'}
            </button>
          )}
        </div>
      </div>

      {/* Expandable segments */}
      {!compact && flight.segments && flight.segments.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="w-3.5 h-3.5" /> Hide details</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" /> Show details</>
            )}
          </button>

          {expanded && (
            <div className="px-4 pb-3 pt-2 space-y-3 border-t border-border bg-muted/20">
              {flight.segments.map((seg, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <div className="flex-shrink-0 mt-0.5">
                    <Plane className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">
                      {seg.origin} → {seg.destination}
                    </div>
                    <div className="text-muted-foreground">
                      {formatDate(seg.departure)} · {formatTime(seg.departure)} – {formatTime(seg.arrival)}
                    </div>
                    <div className="text-muted-foreground">
                      {seg.carrier} {seg.flightNumber} · {seg.duration}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  flight.refundable
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                )}>
                  {flight.refundable ? '✓ Refundable' : '✗ Non-refundable'}
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {flight.cabinClass.replace('_', ' ')}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
