'use client';

/**
 * FlightCard — Apple/boarding-pass inspired.
 * Large departure/arrival times are the hero. Everything else supports them.
 */

import Image from 'next/image';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, Clock, Plane } from 'lucide-react';
import { cn, formatPrice, formatTime, formatDate, airlineLogo, iataToCity } from '@/lib/utils';
import type { FlightResult } from '@/lib/types';
import { FlexibilityBadge } from '@/components/FlexibilityBadge';
import type { FlexibilityLabel } from '@/lib/scoring/flexibility';

interface FlightCardProps {
  flight: FlightResult;
  onSelect?: (flight: FlightResult) => void;
  selected?: boolean;
  compact?: boolean;
  isBestValue?: boolean;
}

/** Compute layover duration between two ISO datetime strings → "2h 35m" or null */
function calcLayover(arrivalIso: string, departureIso: string): string | null {
  try {
    const diff = new Date(departureIso).getTime() - new Date(arrivalIso).getTime();
    if (diff <= 0 || isNaN(diff)) return null;
    const totalMin = Math.round(diff / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return null;
  }
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

/** Render the flight path line (plane icon + stop badges) between two endpoint dots */
function FlightPathLine({
  stops,
  stopAirports,
  segments,
}: {
  stops: number;
  stopAirports: string[];
  segments: Array<{ destination: string; arrival: string; departure: string }>;
}) {
  const layovers: Array<{ airport: string; duration: string | null }> = segments.length > 1
    ? segments.slice(0, -1).map((seg, i) => ({
        airport:  seg.destination,
        duration: calcLayover(seg.arrival, segments[i + 1].departure),
      }))
    : stopAirports.map(ap => ({ airport: ap, duration: null }));

  return (
    <div className="relative w-full flex items-center">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px
                      bg-gradient-to-r from-teal-400/40 via-teal-500/70 to-teal-400/40" />
      <div className="relative z-10 w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
      <div className="flex-1 flex justify-center">
        {stops === 0 ? (
          <svg className="w-4 h-4 text-teal-600 dark:text-teal-400 relative z-10 -rotate-45"
               viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
          </svg>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {layovers.map((lv, i) => (
              <div key={i} className="flex flex-col items-center relative z-10">
                <span className="text-[9px] bg-amber-100 dark:bg-amber-900/30
                                 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-bold">
                  {iataToCity(lv.airport)}
                </span>
                {lv.duration && (
                  <span className="text-[8px] text-muted-foreground/70 mt-0.5 whitespace-nowrap">
                    {lv.duration}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="relative z-10 w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
    </div>
  );
}

/** Render a timeline list of segments (used in the expandable details pane) */
function SegmentTimeline({ segs }: { segs: FlightResult['segments'] }) {
  if (!segs || segs.length === 0) return null;
  return (
    <div className="px-3 sm:px-4 py-2.5 sm:py-3 space-y-0">
      {segs.map((seg, i) => {
        const layover = i < segs.length - 1
          ? calcLayover(seg.arrival, segs[i + 1].departure)
          : null;
        return (
          <div key={i}>
            <div className="flex items-start gap-2 sm:gap-3 text-xs py-2">
              <div className="flex flex-col items-center pt-1 gap-0 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-teal-500 ring-2 ring-teal-200 dark:ring-teal-700" />
                {(layover || i < segs.length - 1) && (
                  <div className="w-px flex-1 min-h-[32px] bg-teal-500/30 mt-1" />
                )}
              </div>
              <div className="flex-1 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-foreground text-[12px]">
                    {seg.origin} → {seg.destination}
                  </p>
                  <span className="font-mono text-[10px] text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded">
                    {seg.flightNumber || seg.carrier}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">
                  {formatDate(seg.departure)} · {formatTime(seg.departure)} – {formatTime(seg.arrival)}
                </p>
                <p className="text-muted-foreground/60 text-[10px] mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3 inline flex-shrink-0" />
                  Flight time: {seg.duration}
                </p>
              </div>
            </div>
            {layover && (
              <div className="flex items-center gap-2 ml-5 mb-1">
                <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20
                                border border-amber-200 dark:border-amber-700/50
                                text-amber-700 dark:text-amber-400
                                px-2.5 py-1 rounded-full text-[10px] font-semibold">
                  <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                  Layover in {iataToCity(seg.destination)} ({seg.destination}): {layover}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {/* Terminal dot */}
      <div className="flex items-center gap-2 ml-0 pt-0.5 pb-1">
        <div className="w-2 h-2 rounded-full bg-teal-600 ring-2 ring-teal-200 dark:ring-teal-700 flex-shrink-0" />
        <p className="text-[11px] font-semibold text-foreground ml-1">
          {segs[segs.length - 1]?.destination} — {formatTime(segs[segs.length - 1]?.arrival)}, {formatDate(segs[segs.length - 1]?.arrival)}
        </p>
      </div>
    </div>
  );
}

/**
 * Assign labels to fare variants.
 * 1. If the airline provides fare brand names (e.g. "Economy Light"), use those.
 * 2. Otherwise, try condition-based labels (Flex/Standard/Basic).
 * 3. If conditions are identical, fall back to neutral price-tier labels.
 */
function assignFareLabels(variants: NonNullable<FlightResult['fareVariants']>): string[] {
  // ── 1. Prefer airline's own fare brand names when available ────────────
  const brandNames = variants.map(v => v.fareBrandName?.trim() || '');
  const allHaveBrands = brandNames.every(b => b.length > 0);
  const brandsUnique  = new Set(brandNames).size === brandNames.length;
  if (allHaveBrands && brandsUnique) return brandNames;

  // ── 2. Condition-based labels ─────────────────────────────────────────
  const conditionLabels = variants.map(v =>
    v.refundable && v.changeable ? 'Flex' : v.changeable ? 'Standard' : 'Basic'
  );

  const hasDuplicates = conditionLabels.length !== new Set(conditionLabels).size;
  if (!hasDuplicates) return conditionLabels;

  // ── 3. Fallback: price-tier labels ────────────────────────────────────
  const allSame = conditionLabels.every(l => l === conditionLabels[0]);
  const indexed = variants.map((v, i) => ({ price: v.price, i })).sort((a, b) => a.price - b.price);
  const tierLabels = new Array<string>(variants.length);

  if (allSame) {
    if (indexed.length === 2) {
      tierLabels[indexed[0].i] = 'Value';
      tierLabels[indexed[1].i] = 'Premium';
    } else {
      indexed.forEach(({ i }, pos) => {
        if (pos === 0) tierLabels[i] = 'Value';
        else if (pos === indexed.length - 1) tierLabels[i] = 'Premium';
        else tierLabels[i] = 'Plus';
      });
    }
  } else {
    if (indexed.length === 2) {
      tierLabels[indexed[0].i] = 'Basic';
      tierLabels[indexed[1].i] = 'Flex';
    } else {
      indexed.forEach(({ i }, pos) => {
        if (pos === 0) tierLabels[i] = 'Basic';
        else if (pos === indexed.length - 1) tierLabels[i] = 'Flex';
        else tierLabels[i] = 'Standard';
      });
    }
  }

  return tierLabels;
}

export function FlightCard({ flight, onSelect, selected, compact, isBestValue }: FlightCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Track which fare variant the user has chosen (0 = cheapest/default)
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);

  const variants = flight.fareVariants;
  const activeVariant = variants?.[selectedVariantIdx];
  // Use the active variant's price if one is selected, otherwise fall back to flight price
  const displayPrice    = activeVariant?.price              ?? flight.price;
  const displayCurrency = activeVariant?.currency           ?? flight.currency;
  const displayRefundable = activeVariant?.refundable       ?? flight.refundable;
  const displayFlexSummary = activeVariant?.flexibilitySummary ?? flight.flexibilitySummary;

  // For round-trips, show the worst-case stops across both legs
  const maxStops = Math.max(flight.stops, flight.isRoundTrip ? (flight.returnStops ?? 0) : 0);
  const stopLabel =
    maxStops === 0 ? 'Non-stop'
    : maxStops === 1 ? '1 stop'
    : `${maxStops} stops`;

  const stopColor =
    maxStops === 0 ? 'text-emerald-600 dark:text-emerald-400'
    : maxStops === 1 ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-500 dark:text-red-400';

  const stopBg =
    maxStops === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20'
    : maxStops === 1 ? 'bg-amber-50 dark:bg-amber-900/20'
    : 'bg-red-50 dark:bg-red-900/20';

  // Build per-layover labels for the route path (uses segments if available)
  const segs = flight.segments ?? [];
  const layovers: Array<{ airport: string; duration: string | null }> = segs.length > 1
    ? segs.slice(0, -1).map((seg, i) => ({
        airport:  seg.destination,
        duration: calcLayover(seg.arrival, segs[i + 1].departure),
      }))
    : (flight.stopAirports ?? []).map(ap => ({ airport: ap, duration: null }));

  const hasSegments = segs.length > 0;
  const hasDetails  = hasSegments || layovers.length > 0 || (flight.returnSegments?.length ?? 0) > 0;

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
        <div className="text-sm font-bold">{formatPrice(displayPrice, displayCurrency)}</div>
      </div>
    );
  }

  const ariaLabel = `${flight.airline} flight from ${flight.origin} to ${flight.destination}, ${formatPrice(displayPrice, displayCurrency)}, ${stopLabel}, ${flight.duration}`;

  return (
    <div
      role="article"
      aria-label={ariaLabel}
      className={cn(
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
            {/* Show first-leg flight number if available, else provider */}
            {segs[0]?.flightNumber ? (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono tracking-wide">
                {segs[0].flightNumber}
                {segs.length > 1 && <span className="ml-1 not-mono opacity-70">+{segs.length - 1} more</span>}
              </p>
            ) : flight.provider ? (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 uppercase tracking-wide">
                via {flight.provider}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isBestValue && (
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300
                             bg-amber-50 dark:bg-amber-900/25 border border-amber-200 dark:border-amber-700
                             px-2 py-0.5 rounded-full">
              Best value
            </span>
          )}
          <span className={cn(
            'text-[11px] font-semibold px-2.5 py-0.5 rounded-full',
            stopBg, stopColor
          )}>
            {stopLabel}
          </span>
          {/* Flexibility badge — shows active variant's policy; falls back to flight-level data */}
          {(activeVariant?.flexibilityLabel ?? flight.flexibilityLabel) ? (
            <FlexibilityBadge
              label={(activeVariant?.flexibilityLabel ?? flight.flexibilityLabel) as FlexibilityLabel}
              summary={activeVariant?.flexibilitySummary ?? flight.flexibilitySummary}
              score={activeVariant?.flexibilityScore ?? flight.flexibilityScore}
              size="sm"
            />
          ) : displayRefundable ? (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400
                             bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full">
              Refundable
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Hero: outbound leg ────────────────────────────────────────────── */}
      {flight.isRoundTrip && (
        <div className="mx-4 mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-widest">
          <Plane className="w-3 h-3 -rotate-45" />
          <span>Outbound</span>
        </div>
      )}
      <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center gap-2">
        {/* Departure */}
        <div className="flex-shrink-0 text-left">
          <p className="text-xl sm:text-2xl font-black text-foreground tracking-tight leading-none">
            {formatTime(flight.departure)}
          </p>
          <p className="text-[12px] sm:text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
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
          <FlightPathLine
            stops={flight.stops}
            stopAirports={flight.stopAirports ?? []}
            segments={segs}
          />
        </div>

        {/* Arrival */}
        <div className="flex-shrink-0 text-right">
          <p className="text-xl sm:text-2xl font-black text-foreground tracking-tight leading-none">
            {formatTime(flight.arrival)}
          </p>
          <p className="text-[12px] sm:text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
            {flight.destination}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {formatDate(flight.arrival)}
          </p>
        </div>
      </div>

      {/* ── Return leg (round-trip only) ──────────────────────────────────── */}
      {flight.isRoundTrip && flight.returnDeparture && (
        <>
          {/* Divider */}
          <div className="mx-4 flex items-center gap-2">
            <div className="flex-1 h-px bg-border/60 border-dashed" style={{ borderTop: '1px dashed', borderColor: 'var(--border)' }} />
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-widest flex-shrink-0">
              <Plane className="w-3 h-3 rotate-[135deg]" />
              <span>Return</span>
            </div>
            <div className="flex-1 h-px" style={{ borderTop: '1px dashed', borderColor: 'var(--border)' }} />
          </div>

          {/* Return hero row */}
          <div className="px-3 sm:px-4 py-3 sm:py-4 flex items-center gap-2">
            <div className="flex-shrink-0 text-left">
              <p className="text-xl sm:text-2xl font-black text-foreground tracking-tight leading-none">
                {formatTime(flight.returnDeparture)}
              </p>
              <p className="text-[12px] sm:text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
                {flight.returnOrigin}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {formatDate(flight.returnDeparture)}
              </p>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center px-2 min-w-0">
              <p className="text-[10px] text-muted-foreground mb-1 font-medium tracking-wide">
                {flight.returnDuration}
              </p>
              <FlightPathLine
                stops={flight.returnStops ?? 0}
                stopAirports={flight.returnStopAirports ?? []}
                segments={flight.returnSegments ?? []}
              />
            </div>

            <div className="flex-shrink-0 text-right">
              <p className="text-xl sm:text-2xl font-black text-foreground tracking-tight leading-none">
                {formatTime(flight.returnArrival ?? '')}
              </p>
              <p className="text-[12px] sm:text-[13px] font-bold text-foreground/70 mt-0.5 uppercase tracking-wider">
                {flight.returnDestination}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {formatDate(flight.returnArrival ?? '')}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Child fare disclosure banner ──────────────────────────────────── */}
      {flight.childFareNote && (
        <div className="mx-4 mb-1 px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-900/20
                        border border-sky-200 dark:border-sky-700/50
                        flex items-start gap-2 text-[11px] text-sky-700 dark:text-sky-300">
          <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd" />
          </svg>
          <span>{flight.childFareNote}</span>
        </div>
      )}

      {/* ── Fare variant tabs (only when 2+ variants exist) ──────────────── */}
      {variants && variants.length > 1 && (() => {
        const variantLabels = assignFareLabels(variants);
        // Check if all variants have identical conditions
        const allSameConditions = variants.every(v =>
          v.refundable === variants[0].refundable && v.changeable === variants[0].changeable
        );
        // Compute price diff from cheapest for each variant
        const cheapestPrice = Math.min(...variants.map(v => v.price));
        return (
        <div className="mx-4 mb-2">
          {allSameConditions && (
            <p className="text-[9px] text-muted-foreground/60 mb-1 text-center">
              All fares: {variants[0].refundable ? 'refundable' : 'non-refundable'} · {variants[0].changeable ? 'changeable' : 'no changes'} — pricing tiers only
            </p>
          )}
          <div className="flex gap-1.5">
          {variantLabels.map((label, i) => {
            const v = variants[i];
            const isActive = i === selectedVariantIdx;
            const priceDiff = v.price - cheapestPrice;
            return (
              <button
                key={v.offerId}
                onClick={() => setSelectedVariantIdx(i)}
                title={`${label} · ${formatPrice(v.price, v.currency)}${v.flexibilitySummary ? ' · ' + v.flexibilitySummary : ''}`}
                className={cn(
                  'flex-1 rounded-lg px-1.5 py-2 text-center transition-all border text-left',
                  isActive
                    ? i === variants.length - 1 && variants.length > 1
                      ? 'bg-emerald-50 dark:bg-emerald-900/25 border-emerald-400 dark:border-emerald-600'
                      : i > 0 && i < variants.length - 1
                      ? 'bg-amber-50 dark:bg-amber-900/25 border-amber-400 dark:border-amber-600'
                      : 'bg-muted/70 border-foreground/25'
                    : 'bg-transparent border-border hover:bg-muted/40'
                )}
              >
                <div className={cn(
                  'text-[9px] font-bold uppercase tracking-wide',
                  isActive
                    ? i === variants.length - 1 && variants.length > 1 ? 'text-emerald-700 dark:text-emerald-300'
                    : i > 0 && i < variants.length - 1 ? 'text-amber-700 dark:text-amber-300'
                    : 'text-foreground/70'
                    : 'text-muted-foreground'
                )}>
                  {label}
                </div>
                <div className={cn(
                  'text-[12px] font-black leading-tight',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {formatPrice(v.price, v.currency)}
                </div>
                {/* Baggage info per variant */}
                {v.checkedBags != null && (
                  <div className={cn(
                    'text-[7.5px] leading-tight mt-0.5',
                    isActive ? 'text-muted-foreground/70' : 'text-muted-foreground/50'
                  )}>
                    {v.checkedBags === 0
                      ? <span className="text-red-500/70 dark:text-red-400/70">No checked bags</span>
                      : <span className="text-teal-600 dark:text-teal-400">{v.checkedBags}x checked bag</span>}
                  </div>
                )}
                {/* Fare condition summary — only show when conditions differ between variants */}
                {!allSameConditions && (
                  <div className={cn(
                    'text-[7.5px] leading-tight mt-0.5',
                    isActive ? 'text-muted-foreground/70' : 'text-muted-foreground/50'
                  )}>
                    {v.changeable
                      ? <span className="text-emerald-600 dark:text-emerald-400">Changeable</span>
                      : <span className="text-red-500/70 dark:text-red-400/70">No changes</span>}
                    {' · '}
                    {v.refundable
                      ? <span className="text-emerald-600 dark:text-emerald-400">Refundable</span>
                      : <span className="text-red-500/70 dark:text-red-400/70">No refund</span>}
                  </div>
                )}
                {allSameConditions && priceDiff > 0 && (
                  <div className="text-[8px] text-muted-foreground/50 mt-0.5">
                    +{formatPrice(priceDiff, v.currency)}
                  </div>
                )}
              </button>
            );
          })}
          </div>
        </div>
        );
      })()}

      {/* ── Price + CTA row ───────────────────────────────────────────────── */}
      <div className="mx-4 mb-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">
            {flight.cabinClass?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? 'Economy'}
            {flight.baggage && <span className="ml-2 font-medium text-teal-700 dark:text-teal-300">✓ {flight.baggage}</span>}
          </div>
          {displayFlexSummary && (
            <div className="mt-1.5 text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
              {displayFlexSummary}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xl font-black text-foreground leading-none">
              {formatPrice(displayPrice, displayCurrency)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {flight.isRoundTrip ? 'total · round-trip' : 'total for all passengers'}
            </p>
            {flight.passengers && flight.passengers > 1 && (
              <p className="text-[10px] text-muted-foreground/70">
                {formatPrice(Math.round(displayPrice / flight.passengers * 100) / 100, displayCurrency)} per person
              </p>
            )}
          </div>
          <button
            onClick={() => {
              // Pass the effective flight: override id/bookingToken/price/refundable
              // with the selected variant's values so checkout books the right fare class
              const effectiveFlight = activeVariant
                ? {
                    ...flight,
                    id:           activeVariant.offerId,
                    bookingToken: activeVariant.offerId,
                    price:        activeVariant.price,
                    currency:     activeVariant.currency,
                    refundable:   activeVariant.refundable,
                    flexibilityScore:   activeVariant.flexibilityScore,
                    flexibilityLabel:   activeVariant.flexibilityLabel,
                    flexibilitySummary: activeVariant.flexibilitySummary,
                  }
                : flight;
              onSelect?.(effectiveFlight);
            }}
            aria-label={`Select this ${flight.airline} flight from ${flight.origin} to ${flight.destination}, ${formatPrice(displayPrice, displayCurrency)}`}
            className={cn(
              'px-4 py-3 rounded-xl text-[13px] font-bold transition-all duration-150 flex items-center gap-1.5',
              'min-h-[44px] touch-manipulation -webkit-tap-highlight-color-transparent',
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
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px]
                       text-muted-foreground hover:text-foreground border-t border-border/50
                       bg-muted/20 hover:bg-muted/40 transition-colors"
          >
            {expanded
              ? <><ChevronUp className="w-3 h-3" /> Hide flight details</>
              : <><ChevronDown className="w-3 h-3" /> Flight details{flight.isRoundTrip ? ' · outbound + return' : ` · ${segs.length} leg${segs.length !== 1 ? 's' : ''}`}</>}
          </button>

          {expanded && (
            <div className="bg-muted/15 border-t border-border/40">
              {hasSegments ? (
                <>
                  {/* Outbound segments */}
                  {flight.isRoundTrip && (
                    <div className="px-4 pt-2 pb-0">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                        <Plane className="w-3 h-3 -rotate-45" /> Outbound
                      </p>
                    </div>
                  )}
                  <SegmentTimeline segs={segs} />

                  {/* Return segments */}
                  {flight.isRoundTrip && flight.returnSegments && flight.returnSegments.length > 0 && (
                    <>
                      <div className="mx-4 border-t border-dashed border-border/60" />
                      <div className="px-4 pt-2 pb-0">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                          <Plane className="w-3 h-3 rotate-[135deg]" /> Return
                        </p>
                      </div>
                      <SegmentTimeline segs={flight.returnSegments} />
                    </>
                  )}
                </>
              ) : (
                /* Fallback: just stopAirports with no times */
                <div className="px-4 py-3 space-y-1">
                  {(flight.stopAirports ?? []).map((ap, i) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Stopover: {ap}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
