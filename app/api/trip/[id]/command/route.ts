// ─── /api/trip/[id]/command ──────────────────────────────────────────────────
// AI command endpoint for the Trip Canvas. Takes a natural-language command,
// uses Claude to translate it into a sequence of CanvasOps, and returns those
// ops to the client which applies them via dispatch.
//
// Reuses the existing Anthropic key + agent stack from /api/chat. Uses a
// focused system prompt so Claude understands the canvas state and the small
// set of operations available.
//
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS or ft_canvas cookie).

import { NextRequest, NextResponse } from 'next/server';
import { generateText, tool } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { aggregateFlights, aggregateHotels } from '@/lib/search/aggregator';
import type { NormalizedFlight } from '@/lib/search/types';
import { type CanvasState, type CanvasLeg, type CanvasFlightSelection, type CanvasHotelSelection } from '@/lib/canvas/types';
import { applyOp, type CanvasOp, makeLegId } from '@/lib/canvas/state';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 90;

const anthropic = createAnthropic({
  apiKey: process.env.FLEXE_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// City / IATA resolution: try the local airport-coords map for the most
// common cities (instant) then fall back to Duffel's /places/suggestions
// for everything else. Means the AI can plan a trip to any city Duffel
// books — no manual map updates required.
import { resolveIata } from '@/lib/canvas/airport-coords';
import { resolveAirport } from '@/lib/canvas/airport-resolver';
import { sanitizeChatInput } from '@/lib/security/input-sanitizer';
import {
  normalizeCityKey,
  parseOriginReturnRequest,
  titleCaseCity,
} from '@/lib/canvas/command-intent';

async function toIata(s: string): Promise<string | null> {
  const trimmed = (s ?? '').trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  const local = resolveIata(trimmed);
  if (local) return local;
  const live = await resolveAirport(trimmed);
  return live?.iata ?? null;
}

function sanitizeSessionId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 100) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function isUsableClientState(input: unknown): input is CanvasState {
  if (!input || typeof input !== 'object') return false;
  const state = input as Partial<CanvasState>;
  if (state.version !== 1) return false;
  if (!state.travellers || typeof state.travellers !== 'object') return false;
  if (!Array.isArray(state.legs) || state.legs.length > 20) return false;
  if (typeof state.title !== 'string' || state.title.length > 200) return false;
  return state.legs.every(leg => {
    if (!leg || typeof leg !== 'object') return false;
    const l = leg as Partial<CanvasLeg>;
    return typeof l.id === 'string'
      && typeof l.city === 'string'
      && typeof l.startDate === 'string'
      && typeof l.endDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(l.startDate)
      && /^\d{4}-\d{2}-\d{2}$/.test(l.endDate);
  });
}

function legByPosition(state: CanvasState, position: number): CanvasLeg | null {
  // 1-indexed for human use; clamp to valid range
  const i = Math.max(0, Math.min(state.legs.length - 1, position - 1));
  return state.legs[i] ?? null;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nightCountDays(startDate: string, endDate: string): number {
  const a = new Date(startDate + 'T00:00:00').getTime();
  const b = new Date(endDate + 'T00:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function parseLegOrdinal(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const words: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  };
  if (words[s]) return words[s];
  const n = parseInt(s.replace(/(?:st|nd|rd|th)$/i, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDelayDays(raw: string | undefined): number {
  const text = (raw ?? '').toLowerCase();
  if (/\b(?:a|one)\s+week\b/.test(text)) return 7;
  const weekMatch = text.match(/\b(\d{1,2})\s+weeks?\b/);
  if (weekMatch) return Math.max(1, Math.min(60, parseInt(weekMatch[1], 10) * 7));
  const dayMatch = text.match(/\b(\d{1,2})\s+days?\b/);
  if (dayMatch) return Math.max(1, Math.min(60, parseInt(dayMatch[1], 10)));
  return 7;
}

function monthIndex(raw: string): number | null {
  const key = raw.trim().slice(0, 3).toLowerCase();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const idx = months.indexOf(key);
  return idx === -1 ? null : idx;
}

function ymdFromParts(year: number, monthZeroBased: number, day: number): string {
  return new Date(Date.UTC(year, monthZeroBased, day)).toISOString().slice(0, 10);
}

function parseFlexibleDateWindow(message: string, todayYmd = new Date().toISOString().slice(0, 10)): { dates: string[]; label: string } | null {
  const text = message.toLowerCase();
  const explicitDate = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (explicitDate) {
    return { dates: [explicitDate[0]], label: explicitDate[0] };
  }

  const today = new Date(todayYmd + 'T00:00:00Z');
  const currentYear = today.getUTCFullYear();
  const monthMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
  if (!monthMatch) return null;

  const rawMonth = monthMatch[1].toLowerCase() === 'sept' ? 'sep' : monthMatch[1];
  const month = monthIndex(rawMonth);
  if (month == null) return null;

  let year = currentYear;
  if (month < today.getUTCMonth()) year += 1;

  const dayMatch = text.match(/\b(?:on|around|for)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i)
    ?? text.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (dayMatch) {
    const day = Math.max(1, Math.min(31, parseInt(dayMatch[1], 10)));
    const dates: string[] = [];
    for (let offset = -2; offset <= 2; offset++) {
      const d: Date = new Date(Date.UTC(year, month, day + offset));
      if (d.getUTCMonth() === month) dates.push(d.toISOString().slice(0, 10));
    }
    return { dates, label: `around ${ymdFromParts(year, month, day)}` };
  }

  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (/\b(?:end|late|last week|towards the end)\b/.test(text)) {
    const start = Math.max(1, lastDay - 6);
    return {
      dates: Array.from({ length: lastDay - start + 1 }, (_, i) => ymdFromParts(year, month, start + i)),
      label: `late ${monthMatch[1]} ${year}`,
    };
  }

  if (/\b(?:early|beginning|start)\b/.test(text)) {
    return {
      dates: Array.from({ length: 7 }, (_, i) => ymdFromParts(year, month, i + 1)),
      label: `early ${monthMatch[1]} ${year}`,
    };
  }

  if (/\b(?:mid|middle)\b/.test(text)) {
    return {
      dates: Array.from({ length: 7 }, (_, i) => ymdFromParts(year, month, 12 + i)),
      label: `mid ${monthMatch[1]} ${year}`,
    };
  }

  if (/\b(?:flexible|any day|no particular date|cheapest day|best rate|sometime)\b/.test(text)) {
    const start = Math.max(1, Math.min(lastDay, today.getUTCFullYear() === year && today.getUTCMonth() === month ? today.getUTCDate() : 1));
    const count = Math.min(14, lastDay - start + 1);
    return {
      dates: Array.from({ length: count }, (_, i) => ymdFromParts(year, month, start + i)),
      label: `${monthMatch[1]} ${year}`,
    };
  }

  return null;
}

function cleanPlaceToken(raw: string): string {
  return raw
    .trim()
    .replace(/\b(?:after|for)\s+(?:a|one|\d{1,2})\s+(?:weeks?|days?)\b.*$/i, '')
    .replace(/[.,!?]+$/g, '')
    .trim();
}

function fallbackClarifyingQuestion(message: string, state: CanvasState): string {
  const hasLegReference = /\b(?:after|before|from)\s+(?:first|second|third|fourth|fifth|\d{1,2}(?:st|nd|rd|th)?)\s+leg\b/i.test(message);
  const mentionsRouteChange = /\b(?:flight|flights|fly|to|from|then|after|add|continue|route|leg)\b/i.test(message);
  const mentionsStayChange = /\b(?:days?|nights?|stay|hotel|room)\b/i.test(message);

  if (mentionsRouteChange && state.legs.length > 0) {
    const legList = state.legs.map((leg, i) => `${i + 1}: ${leg.city}${leg.iata ? ` (${leg.iata})` : ''}`).join(', ');
    if (!hasLegReference) {
      return `I need one detail before changing the canvas: which existing leg should I continue from? Current legs are ${legList}.`;
    }
    return 'I need one detail before changing the canvas: should I add flight-only legs, hotel stays too, or both?';
  }

  if (mentionsStayChange && state.legs.length > 0) {
    const legList = state.legs.map((leg, i) => `${i + 1}: ${leg.city}`).join(', ');
    return `I need one detail before changing the canvas: which city or leg should I update? Current legs are ${legList}.`;
  }

  if (!state.homeOrigin && /\b(?:trip|travel|flight|hotel|plan)\b/i.test(message)) {
    return 'Where are you flying from, and what dates or trip length should I use?';
  }

  return "I need one more detail before I change the canvas. What exact city, leg number, dates, or traveller change should I apply?";
}

function findLegByCity(state: CanvasState, cityRaw: string): CanvasLeg | null {
  const city = cityRaw.trim().toLowerCase();
  if (!city) return null;
  return state.legs.find(l => l.city.trim().toLowerCase() === city)
    ?? state.legs.find(l => l.city.trim().toLowerCase().includes(city))
    ?? null;
}

function maybeHandleDirectStayEdit(message: string, state: CanvasState): { ops: CanvasOp[]; message: string } | null {
  const m = message.match(/\b(?:change|make|set|update)\b[\s\S]{0,80}?\b(?:days?|nights?)\s+(?:in|for)\s+([A-Za-z][A-Za-z .'-]{1,80})\s+(?:to|=)\s+(\d{1,2})\b/i)
    ?? message.match(/\b(?:change|make|set|update)\b[\s\S]{0,80}?\b([A-Za-z][A-Za-z .'-]{1,80})\s+(?:to|=)\s+(\d{1,2})\s+(?:days?|nights?)\b/i)
    ?? message.match(/\b(?:number of )?(?:days?|nights?)\s+(?:in|for)\s+([A-Za-z][A-Za-z .'-]{1,80})\s+(?:to|=)\s+(\d{1,2})\b/i);
  if (!m) return null;

  const city = m[1].trim().replace(/[.,!?]+$/, '');
  const days = Math.max(1, Math.min(14, parseInt(m[2], 10)));
  const leg = findLegByCity(state, city);
  if (!leg) return null;

  const idx = state.legs.findIndex(l => l.id === leg.id);
  if (idx === -1) return null;

  const ops: CanvasOp[] = [];
  let cursor = addDaysYmd(leg.startDate, days);
  ops.push({ type: 'update_leg', legId: leg.id, patch: { endDate: cursor } });
  if (leg.flight) ops.push({ type: 'clear_flight', legId: leg.id });
  if (leg.hotel) ops.push({ type: 'clear_hotel', legId: leg.id });
  if (leg.itinerary) ops.push({ type: 'clear_itinerary', legId: leg.id });

  for (let i = idx + 1; i < state.legs.length; i++) {
    const next = state.legs[i];
    const duration = nightCountDays(next.startDate, next.endDate);
    const nextStart = cursor;
    const nextEnd = addDaysYmd(nextStart, duration);
    if (next.startDate !== nextStart || next.endDate !== nextEnd) {
      ops.push({ type: 'update_leg', legId: next.id, patch: { startDate: nextStart, endDate: nextEnd } });
      if (next.flight) ops.push({ type: 'clear_flight', legId: next.id });
      if (next.hotel) ops.push({ type: 'clear_hotel', legId: next.id });
      if (next.itinerary) ops.push({ type: 'clear_itinerary', legId: next.id });
    }
    cursor = nextEnd;
  }

  return {
    ops,
    message: `Updated ${leg.city} to ${days} day${days === 1 ? '' : 's'} and shifted the later stops to keep the trip continuous. I cleared stale priced flights/hotels for the changed dates so you can re-search live rates.`,
  };
}

// ─── Provider → Canvas mapping helpers (shared by addLeg auto-search + swap*) ──

// Build a `childrenAges` array from canvas state. Prefers explicit ages from
// state.travellers.childAges; otherwise pads/truncates with a safe default age
// (8) so Duffel still prices the kids as children rather than dropping them.
// A child age <2 maps to a Duffel "infant_without_seat" via duffel.ts using
// the `infants` count, so we split here: < 2 → infant, 2–17 → child.
function deriveAges(state: CanvasState): { childrenAges: number[]; infants: number } {
  const count   = Math.max(0, state.travellers.children ?? 0);
  if (count === 0) return { childrenAges: [], infants: 0 };
  const explicit = (state.travellers as { childAges?: number[] }).childAges ?? [];
  const filled   = Array.from({ length: count }, (_, i) => {
    const a = explicit[i];
    return Number.isFinite(a) ? Math.max(0, Math.min(17, Math.floor(a as number))) : 8;
  });
  const infants      = filled.filter(a => a < 2).length;
  const childrenAges = filled.filter(a => a >= 2);
  return { childrenAges, infants };
}

function transitProfileFromState(state: CanvasState) {
  const docs = state.meta?.travelDocs;
  if (!docs?.passportCountry) return undefined;
  return {
    passportCountry: docs.passportCountry,
    visaCountries: docs.visaCountries,
    mode: 'filter' as const,
  };
}

async function searchAndPickFlight(
  origin: string,
  destinationIata: string,
  departureDate: string,
  state: CanvasState,
  opts?: {
    nonstop?: boolean;
    avoidAirlines?: string[];
    viaRegions?: Array<'pacific' | 'europe' | 'middleeast'>;
    preferredAirline?: string;
  },
): Promise<CanvasFlightSelection | null> {
  const { childrenAges, infants } = deriveAges(state);
  const result = await aggregateFlights({
    origin,
    destination:    destinationIata,
    departureDate,
    adults:         state.travellers.adults,
    childrenAges:   childrenAges.length > 0 ? childrenAges : undefined,
    infants:        infants > 0 ? infants : undefined,
    cabinClass:     'economy',
    maxConnections: opts?.nonstop ? 0 : undefined,
    avoidAirlines:  opts?.avoidAirlines,
    viaRegions:     opts?.viaRegions,
    transitProfile: transitProfileFromState(state),
  });
  const best = opts?.preferredAirline
    ? (result.flights.find(f => f.airline.toLowerCase().includes(opts.preferredAirline!.toLowerCase())) ?? null)
    : result.flights[0];
  if (!best) return null;
  return flightToCanvasSelection(best, state);
}

function flightToCanvasSelection(best: NormalizedFlight, state: CanvasState): CanvasFlightSelection {
  return {
    offerId:        best.id,
    origin:         best.origin,
    destination:    best.destination,
    airline:        best.airline,
    flightNumber:   best.legs?.[0]?.segments?.[0]?.flightNumber || '',
    departureTime:  best.departure,
    arrivalTime:    best.arrival,
    duration:       best.duration,
    stops:          best.stops,
    stopAirports:   best.stopAirports,
    cabinClass:     'economy',
    priceCents:     Math.round(best.price * 100),
    currency:       best.currency || 'USD',
    flexibility:    best.fareVariants?.[0]?.flexibilityLabel,
    flexibilitySummary: best.fareVariants?.[0]?.flexibilitySummary,
    refundable:     best.refundable,
    baggage:        best.baggage,
    segments:       best.segments,
    legs:           best.legs,
    returnSegments: best.returnSegments,
    returnDeparture: best.returnDeparture,
    returnArrival:   best.returnArrival,
    returnDuration:  best.returnDuration,
    returnStops:     best.returnStops,
    returnStopAirports: best.returnStopAirports,
    pricedFor: {
      adults:    state.travellers.adults,
      children:  state.travellers.children,
      childAges: (state.travellers as { childAges?: number[] }).childAges,
    },
  };
}

async function searchFlexibleFlight(
  origin: string,
  destinationIata: string,
  departureDates: string[],
  state: CanvasState,
  opts?: {
    nonstop?: boolean;
    avoidAirlines?: string[];
    viaRegions?: Array<'pacific' | 'europe' | 'middleeast'>;
    preferredAirline?: string;
  },
): Promise<{ flight: CanvasFlightSelection; date: string; searchedDates: string[] } | null> {
  const uniqueDates = Array.from(new Set(departureDates)).slice(0, 14);
  if (uniqueDates.length === 0) return null;

  const { childrenAges, infants } = deriveAges(state);
  const searches = await Promise.allSettled(uniqueDates.map(async date => {
    const result = await aggregateFlights({
      origin,
      destination:    destinationIata,
      departureDate:  date,
      adults:         state.travellers.adults,
      childrenAges:   childrenAges.length > 0 ? childrenAges : undefined,
      infants:        infants > 0 ? infants : undefined,
      cabinClass:     'economy',
      maxConnections: opts?.nonstop ? 0 : undefined,
      avoidAirlines:  opts?.avoidAirlines,
      viaRegions:     opts?.viaRegions,
      transitProfile: transitProfileFromState(state),
    });
    const best = opts?.preferredAirline
      ? (result.flights.find(f => f.airline.toLowerCase().includes(opts.preferredAirline!.toLowerCase())) ?? null)
      : result.flights[0];
    return best ? { date, best } : null;
  }));

  const candidates = searches
    .flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
    .sort((a, b) => {
      const durationA = a.best.durationMinutes ?? Number.MAX_SAFE_INTEGER;
      const durationB = b.best.durationMinutes ?? Number.MAX_SAFE_INTEGER;
      const priceDelta = a.best.price - b.best.price;
      if (Math.abs(priceDelta) > 50) return priceDelta;
      return durationA - durationB;
    });

  const picked = candidates[0];
  if (!picked) return null;
  return {
    flight: flightToCanvasSelection(picked.best, state),
    date: picked.date,
    searchedDates: uniqueDates,
  };
}

function parseFlightCriteria(criteria: string | undefined): {
  nonstop?: boolean;
  avoidAirlines?: string[];
  viaRegions?: Array<'pacific' | 'europe' | 'middleeast'>;
  preferredAirline?: string;
} {
  const text = criteria ?? '';
  const viaRegions: Array<'pacific' | 'europe' | 'middleeast'> = [];
  if (/\bpacific\b/i.test(text)) viaRegions.push('pacific');
  if (/\beurope|european\b/i.test(text)) viaRegions.push('europe');
  if (/\bmiddle east|middle-east|gulf|dubai|doha|abu dhabi\b/i.test(text)) viaRegions.push('middleeast');

  const avoidAirlines: string[] = [];
  if (/\b(?:no|avoid|without|exclude)\s+Air India\b/i.test(text) || /\bno Air India\b/i.test(text)) {
    avoidAirlines.push('Air India', 'AI');
  }

  const preferredMatch = text.match(/\b(?:choose|select|use|switch to|change to)\s+([A-Za-z][A-Za-z ]+?)(?:\s+Airlines?|\s+flight|\s+only|\s+with|$)/i);
  const preferredAirline = /\bSingapore Airlines?\b/i.test(text)
    ? 'Singapore Airlines'
    : preferredMatch?.[1]?.trim();

  return {
    nonstop: /nonstop|non-stop|direct|1 stop|one stop/i.test(text) ? /nonstop|non-stop|direct/i.test(text) : undefined,
    avoidAirlines: avoidAirlines.length > 0 ? avoidAirlines : undefined,
    viaRegions: viaRegions.length > 0 ? viaRegions : undefined,
    preferredAirline,
  };
}

function parseTravelDocsFromText(text: string): { passportCountry?: string; visaCountries?: string[] } | null {
  const passportCountry =
    /\bIndian passport|India passport|passport\s+(?:is|from)\s+India\b/i.test(text) ? 'IN'
    : /\bCanadian passport|Canada passport|passport\s+(?:is|from)\s+Canada\b/i.test(text) ? 'CA'
    : /\bUS passport|U\.S\. passport|United States passport|American passport\b/i.test(text) ? 'US'
    : /\bUK passport|British passport|United Kingdom passport\b/i.test(text) ? 'GB'
    : /\bAustralian passport|Australia passport\b/i.test(text) ? 'AU'
    : null;

  const visaCountries = new Set<string>();
  if (/\b(?:have|hold|with|valid)\s+(?:a\s+)?(?:US|U\.S\.|United States)\s+(?:visa|status|green card)\b/i.test(text)) visaCountries.add('US');
  if (/\b(?:have|hold|with|valid)\s+(?:a\s+)?(?:Canada|Canadian)\s+(?:visa|status|PR)\b/i.test(text)) visaCountries.add('CA');
  if (/\b(?:have|hold|with|valid)\s+(?:a\s+)?(?:UK|British|United Kingdom)\s+(?:visa|status)\b/i.test(text)) visaCountries.add('GB');
  if (/\b(?:have|hold|with|valid)\s+(?:a\s+)?Schengen\s+(?:visa|status)\b/i.test(text)) visaCountries.add('SCHENGEN');
  if (!passportCountry && visaCountries.size === 0) return null;
  return {
    passportCountry: passportCountry ?? undefined,
    visaCountries: Array.from(visaCountries),
  };
}

async function searchAndPickHotel(
  destinationCity: string,
  checkIn: string,
  checkOut: string,
  state: CanvasState,
): Promise<CanvasHotelSelection | null> {
  const { childrenAges } = deriveAges(state);
  const result = await aggregateHotels({
    destination: destinationCity,
    checkIn,
    checkOut,
    adults:       state.travellers.adults,
    // For hotels, infants go in `childrenAges` too (LiteAPI counts every
    // child including infants for occupancy). We re-include them at age 1.
    childrenAges: state.travellers.children > 0
      ? Array.from({ length: state.travellers.children }, (_, i) => {
          const a = ((state.travellers as { childAges?: number[] }).childAges ?? [])[i];
          return Number.isFinite(a) ? Math.max(0, Math.min(17, Math.floor(a as number))) : 8;
        })
      : undefined,
  });
  const best = result.hotels[0];
  if (!best) return null;
  void childrenAges;
  return {
    rateId:        best.bookingToken || best.id,
    hotelId:       best.id,
    name:          best.name,
    city:          best.city || destinationCity,
    starRating:    best.stars,
    reviewScore:   best.rating,
    perNightCents: Math.round(best.pricePerNight * 100),
    totalCents:    Math.round(best.totalPrice * 100),
    currency:      best.currency || 'USD',
    image:         best.image,
    pricedFor: {
      adults:    state.travellers.adults,
      children:  state.travellers.children,
      childAges: (state.travellers as { childAges?: number[] }).childAges,
    },
  };
}

async function maybeHandleOriginRoundTripRewrite(
  message: string,
  state: CanvasState,
): Promise<{ ops: CanvasOp[]; message: string } | null> {
  const parsed = parseOriginReturnRequest(message);
  if (!parsed) return null;

  const originCode = await toIata(parsed.originCity);
  const returnCode = await toIata(parsed.returnCity ?? parsed.originCity);
  if (!originCode || !returnCode || originCode !== returnCode) return null;

  const originKey = normalizeCityKey(parsed.originCity);
  const destinationOrder: string[] = [];
  const byCity = new Map<string, CanvasLeg[]>();
  for (const leg of state.legs) {
    const key = normalizeCityKey(leg.city);
    if (!key || key === originKey || leg.iata === originCode) continue;
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(leg);
    if (!destinationOrder.includes(key)) destinationOrder.push(key);
  }
  if (destinationOrder.length === 0) return null;

  const ops: CanvasOp[] = [];
  for (const leg of state.legs) {
    ops.push({ type: 'remove_leg', legId: leg.id });
  }
  ops.push({ type: 'set_home_origin', origin: originCode });

  const rebuilt: CanvasLeg[] = [];
  let prevIata = originCode;

  for (const cityKey of destinationOrder) {
    const candidates = byCity.get(cityKey) ?? [];
    const base = candidates[0];
    if (!base) continue;
    const destIata = (base.iata ? await toIata(base.iata) : await toIata(base.city)) ?? base.iata;
    const matchingFlight = candidates
      .map(l => l.flight)
      .find(f => f && f.origin === prevIata && (!destIata || f.destination === destIata));
    const preservedHotel = [...candidates].reverse().find(l =>
      l.hotel && l.startDate === base.startDate && l.endDate === base.endDate
    )?.hotel;

    const searchedFlight = matchingFlight
      ? null
      : (destIata ? await searchAndPickFlight(prevIata, destIata, base.startDate, state) : null);

    const leg: CanvasLeg = {
      id:        makeLegId(),
      city:      base.city,
      iata:      destIata,
      startDate: base.startDate,
      endDate:   base.endDate,
      ...(matchingFlight || searchedFlight ? { flight: (matchingFlight ?? searchedFlight)! } : {}),
      ...(preservedHotel ? { hotel: preservedHotel } : {}),
    };
    rebuilt.push(leg);
    ops.push({ type: 'add_leg', leg });
    if (destIata) prevIata = destIata;
  }

  const lastDestination = rebuilt[rebuilt.length - 1];
  if (lastDestination) {
    const returnFlight = await searchAndPickFlight(prevIata, originCode, lastDestination.endDate, state);
    const returnLeg: CanvasLeg = {
      id:        makeLegId(),
      city:      titleCaseCity(parsed.returnCity ?? parsed.originCity),
      iata:      originCode,
      startDate: lastDestination.endDate,
      endDate:   lastDestination.endDate,
      ...(returnFlight ? { flight: returnFlight } : {}),
    };
    ops.push({ type: 'add_leg', leg: returnLeg });
  }

  return {
    ops,
    message: `Rebuilt the route from ${originCode} through ${rebuilt.map(l => l.city).join(', ')} and back to ${originCode}. I removed duplicate destination legs and kept matching live hotels/flights where they still fit the route.`,
  };
}

async function maybeHandleAnchoredFlightChain(
  message: string,
  state: CanvasState,
): Promise<{ ops: CanvasOp[]; message: string } | null> {
  const anchorMatch = message.match(/\bafter\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th)?)\s+leg\b/i);
  if (!anchorMatch) return null;
  if (!/\b(?:flight|flights|fly|from|to)\b/i.test(message)) return null;

  const anchorPosition = parseLegOrdinal(anchorMatch[1]);
  if (!anchorPosition) return null;
  const anchorLeg = legByPosition(state, anchorPosition);
  if (!anchorLeg) {
    return {
      ops: [],
      message: `I couldn't find leg ${anchorPosition} on the current canvas. Pick an existing leg number and I'll add the next flights from there.`,
    };
  }

  const afterAnchor = message.slice(anchorMatch.index! + anchorMatch[0].length);
  const clauses = afterAnchor
    .split(/\bthen\b|;/i)
    .map(s => s.trim())
    .filter(Boolean);

  const steps: Array<{ destination: string; delayDays: number }> = [];
  for (const clause of clauses) {
    const destMatch = clause.match(/\bto\s+([A-Za-z][A-Za-z .'-]{1,80}?|[A-Za-z]{3})(?=\s+(?:after|for)\b|,|\.|$)/i);
    if (!destMatch) continue;
    const delayMatch = clause.match(/\bafter\s+((?:a|one|\d{1,2})\s+(?:weeks?|days?))/i);
    const destination = cleanPlaceToken(destMatch[1]);
    if (!destination) continue;
    steps.push({ destination, delayDays: parseDelayDays(delayMatch?.[1]) });
  }

  if (steps.length === 0) return null;

  const ops: CanvasOp[] = [];
  let cursorDate = anchorLeg.endDate;
  let origin = (anchorLeg.iata ? await toIata(anchorLeg.iata) : null)
    ?? anchorLeg.flight?.destination
    ?? (await toIata(anchorLeg.city));
  if (!origin) {
    return {
      ops: [],
      message: `I couldn't resolve ${anchorLeg.city} to an airport, so I couldn't add the next flight chain. Give me the 3-letter IATA code for that leg and I'll continue.`,
    };
  }

  const added: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const dest = await toIata(step.destination);
    if (!dest) {
      return {
        ops,
        message: `I added ${added.length} leg${added.length === 1 ? '' : 's'}, then got stuck because I couldn't resolve "${step.destination}" to an airport. Give me the IATA code and I'll continue.`,
      };
    }

    const startDate = addDaysYmd(cursorDate, step.delayDays);
    const nextDelay = steps[i + 1]?.delayDays;
    const endDate = nextDelay ? addDaysYmd(startDate, nextDelay) : addDaysYmd(startDate, 3);
    const flight = await searchAndPickFlight(origin, dest, startDate, state);
    const leg: CanvasLeg = {
      id:        makeLegId(),
      city:      titleCaseCity(step.destination),
      iata:      dest,
      startDate,
      endDate,
      ...(flight ? { flight } : {}),
    };
    ops.push({ type: 'add_leg', leg });
    added.push(`${origin} → ${dest} on ${startDate}${flight ? '' : ' (no live flight found yet)'}`);
    origin = dest;
    cursorDate = startDate;
  }

  return {
    ops,
    message: `Added ${added.join(', ')} after leg ${anchorPosition}. I left hotels empty because you asked specifically for flights.`,
  };
}

async function maybeHandleDirectFlexibleFlightSearch(
  message: string,
  state: CanvasState,
  todayYmd: string,
): Promise<{ ops: CanvasOp[]; message: string } | null> {
  if (!/\bflights?\b/i.test(message)) return null;

  const routeMatch = message.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,80}|[A-Za-z]{3})\s+to\s+([A-Za-z][A-Za-z .'-]{1,80}|[A-Za-z]{3})(?=\s*(?:,|\.|\bvia\b|\bno\b|\bavoid\b|\bsometime\b|\bend\b|\blate\b|\bearly\b|\bmid\b|\bbest\b|\bshortest\b|\bone-way\b|\bround\b|$))/i);
  if (!routeMatch) return null;

  const dateWindow = parseFlexibleDateWindow(message, todayYmd);
  if (!dateWindow || dateWindow.dates.length <= 1) return null;

  const originRaw = cleanPlaceToken(routeMatch[1]);
  const destRaw = cleanPlaceToken(routeMatch[2]);
  const origin = await toIata(originRaw);
  const dest = await toIata(destRaw);
  if (!origin || !dest) {
    return {
      ops: [],
      message: `I need one specific airport code before I can search live flexible dates: ${!origin ? originRaw : destRaw}.`,
    };
  }

  const criteria = parseFlightCriteria(message);
  const found = await searchFlexibleFlight(origin, dest, dateWindow.dates, state, criteria);
  const ops: CanvasOp[] = [];
  if (state.homeOrigin !== origin) ops.push({ type: 'set_home_origin', origin });

  const existingLeg = state.legs.find(l => (l.iata ?? '').toUpperCase() === dest || l.flight?.destination === dest);
  if (!found) {
    const filters = [
      criteria.avoidAirlines?.length ? `excluding ${criteria.avoidAirlines.filter(x => x.length > 2).join(', ') || criteria.avoidAirlines.join(', ')}` : null,
      criteria.viaRegions?.length ? `via ${criteria.viaRegions.join(' or ')}` : null,
      criteria.preferredAirline ? `on ${criteria.preferredAirline}` : null,
    ].filter(Boolean).join(', ');
    if (!existingLeg) {
      ops.push({
        type: 'add_leg',
        leg: {
          id:        makeLegId(),
          city:      /^[A-Z]{3}$/.test(destRaw.toUpperCase()) ? dest : titleCaseCity(destRaw),
          iata:      dest,
          startDate: dateWindow.dates[0],
          endDate:   addDaysYmd(dateWindow.dates[0], 3),
        },
      });
    }
    return {
      ops,
      message: `I searched ${origin} → ${dest} across ${dateWindow.label}${filters ? ` (${filters})` : ''} and found no live matching flight. I left the flight slot empty rather than selecting an option that violates your constraints.`,
    };
  }

  const legId = existingLeg?.id ?? makeLegId();
  if (existingLeg) {
    if (existingLeg.startDate !== found.date) {
      ops.push({ type: 'update_leg', legId, patch: { startDate: found.date, endDate: addDaysYmd(found.date, nightCountDays(existingLeg.startDate, existingLeg.endDate)) } });
    }
    ops.push({ type: 'set_flight', legId, flight: found.flight });
  } else {
    ops.push({
      type: 'add_leg',
      leg: {
        id:        legId,
        city:      /^[A-Z]{3}$/.test(destRaw.toUpperCase()) ? dest : titleCaseCity(destRaw),
        iata:      dest,
        startDate: found.date,
        endDate:   addDaysYmd(found.date, 3),
        flight:    found.flight,
      },
    });
  }

  const searchedRange = `${found.searchedDates[0]} to ${found.searchedDates[found.searchedDates.length - 1]}`;
  const constraintNote = criteria.avoidAirlines?.length
    ? `, excluding ${criteria.avoidAirlines.filter(x => x.length > 2).join(', ') || criteria.avoidAirlines.join(', ')}`
    : '';
  return {
    ops,
    message: `Searched flexible dates ${searchedRange}${constraintNote} and picked the best live match: ${found.flight.airline} ${found.flight.origin} → ${found.flight.destination} on ${found.date} for ${found.flight.currency} ${(found.flight.priceCents / 100).toFixed(0)}. Open the flight picker to compare the other live options.`,
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!DB_AVAILABLE) {
    return NextResponse.json({ error: 'Persistence is not configured' }, { status: 503 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  let body: {
    sessionId?: string;
    message?:   string;
    history?:   Array<{ role: 'user' | 'assistant'; content: string }>;
    state?:     unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = sanitizeSessionId(body.sessionId);
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 });
  }

  const rawMessage = (body.message ?? '').toString().trim();
  if (!rawMessage || rawMessage.length > 1000) {
    return NextResponse.json({ error: 'Missing or invalid message' }, { status: 400 });
  }
  // Sanitize the user-supplied message before it reaches Claude. Strips:
  //   • fake [FLIGHT_CARD] / [HOTEL_CARD] result blocks
  //   • [FLIGHT_SELECTED] / [BOOKING_COMPLETE] state-machine injections
  //   • <system> / <tool_result> / <function_call> / <function_calls>
  //     XML tags that could trick the model into thinking another turn ran
  //   • Markdown image embeds from untrusted hosts (tracking pixels)
  //   • Unicode bidi-override + zero-width characters (homograph attacks)
  // Same hardening that ships for /api/chat — see lib/security/input-sanitizer.ts.
  const message = sanitizeChatInput(rawMessage);
  if (message !== rawMessage) {
    console.warn('[command] sanitized user message', {
      tripId:    id,
      sessionId,
      originalLen: rawMessage.length,
      cleanedLen:  message.length,
    });
  }

  // Optional conversation history — last N turns. Cap at 12 turns to keep
  // token usage bounded while preserving enough context for multi-turn
  // planning ("…and add another 3 days in Rome"). Sanitize each turn too —
  // a malicious past assistant turn could carry an injection payload that
  // the next user message piggybacks off.
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const history = rawHistory
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      role:    m.role,
      content: sanitizeChatInput(String(m.content ?? '').slice(0, 2000)),
    }))
    .filter(m => m.content.trim().length > 0);

  // Ownership check
  const row = await db.tripsCanvas.get(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.session_id !== sessionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Working state — mutates as ops are pushed so subsequent tool calls in the
  // same turn (e.g. swapFlight after addLeg) see the updated leg list.
  // Prefer the client-sent canvas after ownership is verified. The canvas
  // saves with a debounce, so a drag-reorder followed immediately by a chat
  // edit can be ahead of the DB by a few hundred ms. Booking still verifies
  // provider offer IDs/prices server-side; this state is only used to produce
  // planning ops against the user's latest visible canvas.
  let workingState: CanvasState = isUsableClientState(body.state) ? body.state : row.state;
  const ops:      CanvasOp[] = [];
  const messages: string[]   = [];

  function pushOp(op: CanvasOp) {
    ops.push(op);
    workingState = applyOp(workingState, op);
  }

  const mentionedTravelDocs = parseTravelDocsFromText(message);
  if (mentionedTravelDocs) {
    pushOp({
      type: 'set_travel_docs',
      passportCountry: mentionedTravelDocs.passportCountry ?? workingState.meta.travelDocs?.passportCountry,
      visaCountries: Array.from(new Set([
        ...(workingState.meta.travelDocs?.visaCountries ?? []),
        ...(mentionedTravelDocs.visaCountries ?? []),
      ])),
    });
  }

  const directFlexibleFlight = await maybeHandleDirectFlexibleFlightSearch(message, workingState, new Date().toISOString().slice(0, 10));
  if (directFlexibleFlight) {
    for (const op of directFlexibleFlight.ops) pushOp(op);
    return NextResponse.json({ ops, message: directFlexibleFlight.message, partial: false });
  }

  const directOriginRoundTrip = await maybeHandleOriginRoundTripRewrite(message, workingState);
  if (directOriginRoundTrip) {
    for (const op of directOriginRoundTrip.ops) pushOp(op);
    return NextResponse.json({ ops, message: directOriginRoundTrip.message, partial: false });
  }

  const directAnchoredFlightChain = await maybeHandleAnchoredFlightChain(message, workingState);
  if (directAnchoredFlightChain) {
    for (const op of directAnchoredFlightChain.ops) pushOp(op);
    return NextResponse.json({ ops, message: directAnchoredFlightChain.message, partial: false });
  }

  const directStayEdit = maybeHandleDirectStayEdit(message, workingState);
  if (directStayEdit) {
    for (const op of directStayEdit.ops) pushOp(op);
    return NextResponse.json({ ops, message: directStayEdit.message, partial: false });
  }

  // ─── AI tools — small focused set that maps directly to canvas ops ─────────

  const setHomeOriginTool = tool({
    description: 'Set the user\'s home airport (origin for the first flight).',
    parameters: z.object({
      iata: z.string().describe('3-letter IATA code OR city name (we will normalize).'),
    }),
    execute: async ({ iata }) => {
      const code = await toIata(iata);
      if (!code) {
        return { ok: false, reason: `couldn't resolve "${iata}" to a known airport — ask the user for a more specific city name or 3-letter IATA code` };
      }
      pushOp({ type: 'set_home_origin', origin: code });
      return { ok: true, code };
    },
  });

  const addLegTool = tool({
    description: 'Add a new stop (city + dates) to the trip. Optionally also auto-search and pick a flight + hotel for it. For multi-city trips, prefer calling this with autoSearchFlight=true and autoSearchHotel=true so the canvas fills in one shot per leg.',
    parameters: z.object({
      city:      z.string().describe('Destination city, e.g. "Rome"'),
      iata:     z.string().optional().describe('Optional 3-letter airport code. If omitted, will be looked up.'),
      startDate: z.string().describe('YYYY-MM-DD arrival date'),
      endDate:   z.string().describe('YYYY-MM-DD departure date (must be on or after startDate)'),
      autoSearchFlight: z.boolean().optional().describe('If true, also pick the cheapest flight from the prior leg (or home airport) into this destination.'),
      autoSearchHotel:  z.boolean().optional().describe('If true, also pick the top-rated hotel for the leg.'),
      nonstopOnly: z.boolean().optional().describe('Only apply when autoSearchFlight is true — restrict to nonstop flights.'),
    }),
    execute: async ({ city, iata, startDate, endDate, autoSearchFlight, autoSearchHotel, nonstopOnly }) => {
      // Prefer the explicit `iata` argument; otherwise resolve the city via
      // Duffel. Anything we can't resolve stays undefined — the leg is still
      // added so the user can supply an IATA later, but the auto-search
      // skips with a clear reason.
      const finalIata = (iata ? await toIata(iata) : await toIata(city)) ?? undefined;
      const newLegId = makeLegId();
      pushOp({
        type: 'add_leg',
        leg: { id: newLegId, city, iata: finalIata, startDate, endDate },
      });

      const summary: Record<string, unknown> = { ok: true, legId: newLegId };

      if (autoSearchFlight) {
        const idx = workingState.legs.findIndex(l => l.id === newLegId);
        const prev = idx > 0 ? workingState.legs[idx - 1] : null;
        const origin = prev
          ? ((await toIata(prev.iata || prev.city)) ?? workingState.homeOrigin ?? '')
          : (workingState.homeOrigin || '');
        const dest = finalIata ?? (await toIata(city)) ?? null;

        if (!origin) {
          summary.flight = { skipped: 'no origin — ask user to set home airport first' };
        } else if (!dest) {
          summary.flight = { skipped: `couldn't resolve "${city}" to an airport — ask the user for a 3-letter IATA code` };
        } else {
          const flight = await searchAndPickFlight(
            origin, dest, startDate, workingState,
            { nonstop: nonstopOnly },
          );
          if (flight) {
            pushOp({ type: 'set_flight', legId: newLegId, flight });
            summary.flight = { airline: flight.airline, price: flight.priceCents / 100 };
          } else {
            summary.flight = { skipped: 'no flights found' };
          }
        }
      }

      if (autoSearchHotel) {
        const hotel = await searchAndPickHotel(city, startDate, endDate, workingState);
        if (hotel) {
          pushOp({ type: 'set_hotel', legId: newLegId, hotel });
          summary.hotel = { name: hotel.name, perNight: hotel.perNightCents / 100 };
        } else {
          summary.hotel = { skipped: 'no hotels found' };
        }
      }

      return summary;
    },
  });

  const removeLegTool = tool({
    description: 'Remove a stop from the trip. legPosition is 1-indexed (1 = first leg).',
    parameters: z.object({
      legPosition: z.number().int().min(1).describe('1-indexed leg number to remove'),
    }),
    execute: async ({ legPosition }) => {
      const leg = legByPosition(workingState, legPosition);
      if (!leg) return { ok: false, reason: 'leg not found' };
      pushOp({ type: 'remove_leg', legId: leg.id });
      return { ok: true };
    },
  });

  const setTravellersTool = tool({
    description: 'Update the number of travellers (adults + children).',
    parameters: z.object({
      adults:   z.number().int().min(1).max(9),
      children: z.number().int().min(0).max(9).optional(),
    }),
    execute: async ({ adults, children }) => {
      pushOp({ type: 'set_travellers', adults, children: children ?? workingState.travellers.children });
      return { ok: true };
    },
  });

  const setTravelDocsTool = tool({
    description: 'Set non-sensitive travel document eligibility: passport country and countries/areas where the traveller already holds valid visa/transit/residency status. Never ask for passport numbers in chat.',
    parameters: z.object({
      passportCountry: z.string().regex(/^[A-Za-z]{2}$/).optional().describe('ISO 3166-1 alpha-2 passport country, e.g. IN for Indian passport.'),
      visaCountries: z.array(z.string().regex(/^[A-Za-z]{2}$|^EU$|^SCHENGEN$/i)).max(30).optional().describe('Countries/areas where user says they already hold valid visa/transit/residency status, e.g. ["US", "CA", "SCHENGEN"].'),
    }),
    execute: async ({ passportCountry, visaCountries }) => {
      pushOp({
        type: 'set_travel_docs',
        passportCountry: passportCountry?.toUpperCase(),
        visaCountries: visaCountries?.map(v => v.toUpperCase()),
      });
      return { ok: true };
    },
  });

  const extendStayTool = tool({
    description: 'Extend a stop by N days (push the end date later).',
    parameters: z.object({
      legPosition: z.number().int().min(1),
      byDays:      z.number().int().min(1).max(60),
    }),
    execute: async ({ legPosition, byDays }) => {
      const leg = legByPosition(workingState, legPosition);
      if (!leg) return { ok: false, reason: 'leg not found' };
      const d = new Date(leg.endDate + 'T00:00:00');
      d.setDate(d.getDate() + byDays);
      const newEnd = d.toISOString().slice(0, 10);
      pushOp({ type: 'update_leg', legId: leg.id, patch: { endDate: newEnd } });
      return { ok: true, newEndDate: newEnd };
    },
  });

  const swapFlightTool = tool({
    description: 'Find and swap to a different flight for an existing leg. Triggers a fresh flight search and picks the cheapest matching the criteria.',
    parameters: z.object({
      legPosition: z.number().int().min(1),
      criteria:    z.string().optional().describe('Free-form criteria like "nonstop", "morning departure", "cheaper".'),
    }),
    execute: async ({ legPosition, criteria }) => {
      const leg = legByPosition(workingState, legPosition);
      if (!leg) return { ok: false, reason: 'leg not found' };

      const idx = workingState.legs.findIndex(l => l.id === leg.id);
      const prev = idx > 0 ? workingState.legs[idx - 1] : null;
      const origin = prev
        ? ((await toIata(prev.iata || prev.city)) ?? workingState.homeOrigin ?? '')
        : (workingState.homeOrigin || '');
      if (!origin) return { ok: false, reason: 'no origin set; ask the user to set their home airport' };
      if (!leg.iata && !leg.city) return { ok: false, reason: 'leg has no destination' };

      const dest = await toIata(leg.iata || leg.city);
      if (!dest) return { ok: false, reason: `couldn't resolve "${leg.city}" to an airport; ask user for the 3-letter IATA code` };

      const parsedCriteria = parseFlightCriteria(criteria);
      const flight = await searchAndPickFlight(
        origin,
        dest,
        leg.startDate,
        workingState,
        parsedCriteria,
      );
      if (!flight) {
        return {
          ok: false,
          reason: parsedCriteria.preferredAirline
            ? `no live ${parsedCriteria.preferredAirline} flight found for ${origin} → ${dest} on ${leg.startDate} with the current filters`
            : `no flights found for ${origin} → ${dest} on ${leg.startDate} with the current filters`,
        };
      }

      pushOp({ type: 'set_flight', legId: leg.id, flight });
      return { ok: true, airline: flight.airline, price: flight.priceCents / 100 };
    },
  });

  const swapHotelTool = tool({
    description: 'Find and swap to a different hotel for an existing leg.',
    parameters: z.object({
      legPosition: z.number().int().min(1),
      criteria:    z.string().optional().describe('Free-form criteria like "near Pantheon", "kid-friendly", "cheaper".'),
    }),
    execute: async ({ legPosition, criteria: _criteria }) => {
      const leg = legByPosition(workingState, legPosition);
      if (!leg) return { ok: false, reason: 'leg not found' };

      const hotel = await searchAndPickHotel(leg.city, leg.startDate, leg.endDate, workingState);
      if (!hotel) return { ok: false, reason: 'no hotels found' };

      pushOp({ type: 'set_hotel', legId: leg.id, hotel });
      return { ok: true, name: hotel.name };
    },
  });

  const respondTool = tool({
    description: 'Respond conversationally without making any canvas changes. Use when the user asks a question, when summarizing a multi-leg trip, or when you need clarification. Keep responses under ~3 short paragraphs.',
    parameters: z.object({
      text: z.string().min(1).max(4000),
    }),
    execute: async ({ text }) => {
      messages.push(text);
      return { ok: true };
    },
  });

  // ─── Run Claude ──────────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const interests = workingState.meta?.interests ?? [];
  const stateSummary = {
    title:      workingState.title,
    travellers: workingState.travellers,
    homeOrigin: workingState.homeOrigin,
    travelDocs: workingState.meta?.travelDocs,
    interests:  interests.length > 0 ? interests : undefined,
    legs:       workingState.legs.map((l, i) => ({
      position: i + 1,
      legId:    l.id,
      city:     l.city,
      iata:     l.iata,
      dates:    `${l.startDate} → ${l.endDate}`,
      flight:   l.flight ? `${l.flight.airline} ${l.flight.origin}→${l.flight.destination} $${(l.flight.priceCents/100).toFixed(0)}` : null,
      hotel:    l.hotel  ? `${l.hotel.name} $${(l.hotel.perNightCents/100).toFixed(0)}/n` : null,
    })),
  };

  // Translate vibe ids → natural-language hints the model can act on
  const VIBE_HINTS: Record<string, string> = {
    beach:     'beach + sun stays; oceanfront preferred',
    romance:   'romantic, quiet, candle-lit; couples-leaning hotels',
    foodie:    'walkable food scenes; chef-driven hotels; nearby dinner-worthy neighbourhoods',
    culture:   'museums, history, walkable old towns',
    adventure: 'hiking, diving, outdoor activities; active stays',
    wellness:  'spa, yoga, slow pace; wellness retreats',
    city:      'city centre, walkable cafés and sidewalks',
    family:    'family-friendly stays, pools, kid-safe areas; avoid party districts',
    wildlife:  'safaris, reefs, eco-lodges',
    luxury:    'high-end stays, no-compromise picks',
    budget:    'best value first; cap nightly rate',
    offbeat:   'fewer crowds; lesser-known spots',
  };
  const interestsBlock = interests.length > 0
    ? `\n\nUSER VIBES (bias hotel/activity picks toward these — do not block, just lean):\n${interests.map(id => `- ${id}: ${VIBE_HINTS[id] ?? id}`).join('\n')}\n`
    : '';

  const system = `You are the AI editor for a Trip Canvas. The user has a visual trip-planning canvas open and wants to make changes to it via natural language.

Today is ${today}.

CURRENT CANVAS STATE:
${JSON.stringify(stateSummary, null, 2)}${interestsBlock}

RULES:
- Translate the user's request into one or more tool calls.
- Preserve the CURRENT CANVAS ORDER exactly unless the user explicitly asks to reorder. Never recreate an older route from chat history.
- Treat CURRENT CANVAS STATE as the source of truth. Conversation history can explain intent, but it must never override the visible canvas.
- Never append a second copy of an existing trip. If the user changes origin, return city, date count, travellers, or constraints for an existing route, UPDATE the existing legs or remove/rebuild the affected legs. Do not add duplicate Toronto/Montreal/Halifax-style sequences on top of the old one.
- Never infer the user's home/origin from the first destination. "Plan a trip covering Toronto, Montreal, Halifax" means those are destinations, not proof that Toronto is home.
- If the user asks for a multi-city trip but gives no departure city/home airport, add destination legs and hotels only if useful, then respond with one clear question asking where they are flying from before searching flights.
- If the user later says "flying from X ... and back to X", setHomeOrigin to X, make the first flight X → first destination, chain inter-city flights, and add a final return-flight leg from last destination → X. This is a route correction, not a request to append a duplicate trip.
- Do not claim "all set", "booked", "confirmed", or "full itinerary" unless the needed canvas selections actually exist. If a flight/hotel search skipped or failed, say exactly what is missing.
- Be explicit when choices are provisional: prices, availability, child fares, baggage, cancellation rules, and taxes are supplier-confirmed at booking time.
- When editing one city's day count, update that existing leg by city/position and shift later dates; do not add new legs or reorder legs.
- For "fly from X" or "I'm in X" → setHomeOrigin (do this FIRST in any planning request that mentions a home city).
- For "add N days in CITY" → addLeg.
- For "remove leg N" or "delete CITY" → removeLeg.
- For "extend Paris by 2 days" → extendStay.
- For "find a cheaper hotel" / "near X" / "kid-friendly" → swapHotel with criteria.
- For "find a nonstop flight" / "morning flight" → swapFlight with criteria.
- For airline/routing constraints ("avoid Air India", "via Pacific or Europe", "Singapore Airlines only"), pass the exact words in swapFlight.criteria. Do not select a flight that violates those constraints.
- Never recommend or claim an airline is available unless it came from the live flight search or already exists on the current canvas. If a requested airline/filter returns no live option, say that directly and leave the current selection unchanged.
- Do not tell the user to manually search Google Flights or an airline website as the main answer. Ask whether they want to adjust date/origin/routing, or leave the slot empty.
- For "we are 3 adults and 2 kids" → setTravellers.
- If the user mentions passport nationality or transit visas ("Indian passport", "I have a US visa", "do I need transit visa"), call setTravelDocs with passportCountry and visaCountries when the data is present. Ask only ONE targeted question if passport country or held transit/entry visas are missing.
- Never ask for passport number, date of birth, or document images in chat. Only ask country of passport and whether they already hold valid visas/status for likely transit countries.
- When searching flights and a passport country is known, flight tools automatically filter known blocked transit routings. Do not override that filtering in prose.
- For questions that don't change the canvas (e.g. "what's the total?" or "do I need a visa?") → respond with concise plain text.

MULTI-CITY PLANNING:
- When the user asks for a trip across multiple cities ("Paris, Rome, London", "Bali then Tokyo"), call setHomeOrigin (if needed) and then addLeg ONCE PER CITY with autoSearchFlight=true and autoSearchHotel=true. The canvas will fill in flights and hotels for each leg automatically.
- Exception: if the user did not give a home/origin city, do not call setHomeOrigin and do not autoSearchFlight. Add the destination stops in order, optionally autoSearchHotel=true, then ask for the departure city/home airport.
- Chain dates so each leg's startDate equals the previous leg's endDate.
- Respect the user's total trip length when distributing days across cities. Default to 3-4 days per city if unspecified.
- For round-trip itineraries, the final leg is a return-flight-only leg from the last destination back to the home airport. Do not attach a hotel to the return-home leg unless the user explicitly wants to stay there.
- Do NOT call swapFlight/swapHotel for legs you just added with autoSearch — that doubles the work.
- After adding all legs, use respond to give a one-sentence summary like "Added Paris (4 nights), Rome (3), London (3) — see the canvas."

SCALE & VAGUE INPUTS:
- Each addLeg with autoSearch costs 1–3 tool calls (add + optional flight + optional hotel). Your tool-call budget is generous — feel free to plan up to ~8 cities in a single turn with full auto-search. Larger requests, do 8 cities and ask the user if they want more added.
- For vague references like "5 popular places around Vienna", pick concrete cities yourself and tell the user what you picked in the respond message so they can swap any. Do NOT bounce back asking the user to choose from a list when you have a confident pick — they're trusting your judgment.
- ALWAYS end with a respond call that summarizes what's on the canvas now and invites the next change ("Added London, Paris, Amsterdam, Vienna, Salzburg, Bratislava, Budapest, Graz — let me know if you want to swap any hotel, drop a city, or add a return flight.").

DATE HANDLING:
- Use ISO YYYY-MM-DD for all dates.
- If the user gives relative dates ("next month", "in May"), pick concrete dates.
- For multi-city, do NOT leave gaps between legs (the next leg's start = previous leg's end).

SAFETY:
- If the request is ambiguous, use respond to ask ONE clarifying question. Do NOT make destructive changes when unclear.
- Never answer only "Done." If you did not make a canvas-changing tool call, explain what is missing or ask one clarifying question.
- Clarifying questions must be targeted to the missing field that blocks execution. Ask for the exact origin, destination, leg number, date/duration, traveller age/count, budget, or hotel/flight preference needed to run the next tool call. Do not ask generic questions like "Can you clarify?".
- Phrase clarification so the user knows what will happen next. Example: "Which leg should I continue from — 1: San Francisco or 2: Mumbai? Once you pick one, I'll add the next flight legs from there."
- Never hide missing data. If no flights/hotels are found, say "I couldn't find a live option for X yet" and leave that slot empty for manual search.
- Never invent provider names, prices, hotel amenities, cancellation policy, baggage, taxes, or booking status. Only summarize values returned by tools or already present in CURRENT CANVAS STATE.
- Keep responses brief: at most one sentence per tool call. No marketing fluff.`;

  // Track AI errors but DON'T discard partial work — return whatever ops were
  // collected before the failure so the user sees progress instead of nothing.
  let aiError: string | null = null;
  try {
    await generateText({
      model: anthropic('claude-sonnet-4-6' as never),  // legacy model id; matches /api/chat
      system,
      messages: [
        ...history,
        { role: 'user', content: message },
      ],
      tools: {
        setHomeOrigin:  setHomeOriginTool,
        addLeg:         addLegTool,
        removeLeg:      removeLegTool,
        setTravellers:  setTravellersTool,
        setTravelDocs:  setTravelDocsTool,
        extendStay:     extendStayTool,
        swapFlight:     swapFlightTool,
        swapHotel:      swapHotelTool,
        respond:        respondTool,
      },
      // 25 steps lets the AI plan ~10 cities in one turn (homeOrigin + 10×addLeg with autoSearch + return + summary).
      // Each step is 1 tool call. Bigger turns happen rarely; for very large trips users will iterate.
      maxSteps:  25,
      // Each tool call uses ~50 input tokens; 4000 output tokens covers complex multi-city responses.
      maxTokens: 4000,
    });
  } catch (e) {
    aiError = e instanceof Error ? e.message : 'AI request failed';
    console.error('[/api/trip/[id]/command] AI error after', ops.length, 'ops:', e);
  }

  // If we collected ANY ops, return them — partial success is better than nothing.
  // Only return a hard 502 when nothing happened AND the AI errored AND there's no message.
  if (aiError && ops.length === 0 && messages.length === 0) {
    return NextResponse.json(
      { error: 'AI command failed', message: aiError, ops: [] },
      { status: 502 },
    );
  }

  let combinedMessage = messages.join(' ').trim();
  if (aiError) {
    const partial = ops.length > 0 ? `Applied ${ops.length} change${ops.length === 1 ? '' : 's'} before hitting a snag.` : '';
    combinedMessage = [combinedMessage, partial, 'Send another message to keep going.'].filter(Boolean).join(' ');
  }
  if (!combinedMessage && ops.length === 0) {
    combinedMessage = fallbackClarifyingQuestion(message, workingState);
  }

  return NextResponse.json({
    ops,
    message:  combinedMessage,
    partial:  Boolean(aiError),
  });
}
