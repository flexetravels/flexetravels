// ─── Deterministic critic — post-generation consistency checks ────────────────
// Runs AFTER Claude finishes streaming in app/api/chat/route.ts. Pure
// functions — zero LLM tokens, zero extra latency. Observes drift against
// the skill rules; does NOT currently patch responses (first pass: observe
// first, patch later once we have data).
//
// Why deterministic, not an LLM critic: the Google loop-agent pattern
// (generator → critic → approved) doubles token cost for checks that are
// mostly binary. We keep the LLM critic option open for fuzzy cases
// (see FLEXE_LLM_CRITIC in a future phase).

import type { NormalizedFlight, NormalizedHotel } from '@/lib/search/types';

// ─── Check registry ──────────────────────────────────────────────────────────

export type CheckSeverity = 'error' | 'warn';
export type CheckId =
  | 'no_flight_card_tag'
  | 'no_hotel_card_tag'
  | 'no_booking_confirmed_tag'
  | 'cheapest_flight_price_present'
  | 'cheapest_hotel_price_present'
  | 'dot_24h_disclosure_present'
  | 'service_fee_mentioned'
  | 'direct_flight_rule_respected'
  | 'response_length_reasonable'
  | 'no_fabricated_airline'
  | 'no_pii_acknowledgement';

export interface CriticIssue {
  id:       CheckId;
  severity: CheckSeverity;
  message:  string;
  detail?:  Record<string, unknown>;
}

export interface CriticContext {
  lastUserMessage:  string;
  flightResults?:   NormalizedFlight[];
  hotelResults?:    NormalizedHotel[];
  /** Origin IATA from the most recent flight search (used for DOT check). */
  flightOrigin?:    string;
  /** Outbound departure date (YYYY-MM-DD) from the most recent flight search. */
  flightDepartureDate?: string;
  /** Conversation state at response time. */
  conversationState?: string;
}

export interface CriticReport {
  passed:   boolean;
  issues:   CriticIssue[];
  ranCount: number;
}

// ─── US IATA prefix table (small, covers majors) ─────────────────────────────
const US_AIRPORTS = new Set([
  'JFK','EWR','LGA','LAX','SFO','ORD','MDW','MIA','FLL','ATL','DFW','IAH','HOU',
  'BOS','SEA','DEN','PHX','LAS','MCO','TPA','DCA','IAD','BWI','DTW','MSP','PDX',
  'CLT','PHL','SAN','SJC','OAK','AUS','NSH','RDU','SLC','STL','PIT','CLE','CVG',
]);

// ─── Card-tag regexes ────────────────────────────────────────────────────────
const RE_FLIGHT_CARD = /\[FLIGHT_CARD[\s\S]*?\[\/FLIGHT_CARD\]|\[FLIGHT_CARD[^\]]*\]\s*\{/i;
const RE_HOTEL_CARD  = /\[HOTEL_CARD[\s\S]*?\[\/HOTEL_CARD\]|\[HOTEL_CARD[^\]]*\]\s*\{/i;
const RE_BOOKING     = /\[(HOTEL_BOOKING_CONFIRMED|BOOKING_CONFIRMED)\b/i;

// PII leak detection — Claude should never echo a passport/credit-card/DOB it
// saw in a user message. Detects common patterns in the assistant response.
const RE_CC_LIKE    = /\b(?:\d[ -]?){13,19}\b/;
const RE_DOB_LIKE   = /\b(19|20)\d{2}[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/;
const RE_PASSPORT   = /\b(passport|passport number|passport no\.?)\s*[:#]?\s*[A-Z0-9]{6,}\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

function cheapest<T extends { price?: number; pricePerNight?: number }>(
  items: T[],
  key: 'price' | 'pricePerNight',
): T | undefined {
  if (!items?.length) return undefined;
  return items.reduce((best, x) => (x[key]! < (best[key] ?? Infinity) ? x : best), items[0]);
}

function priceStringsForFlight(f: NormalizedFlight): string[] {
  // Covers "$489", "$489.00", "$489 USD", "489 USD"
  const p = Math.round(f.price);
  const pFloat = f.price.toFixed(2);
  return [`$${p}`, `$${pFloat}`, `${p} ${f.currency || 'USD'}`, `${pFloat} ${f.currency || 'USD'}`];
}

function priceStringsForHotel(h: NormalizedHotel): string[] {
  const p = Math.round(h.pricePerNight);
  const pFloat = h.pricePerNight.toFixed(2);
  return [`$${p}`, `$${pFloat}`, `${p} ${h.currency || 'USD'}`, `${pFloat} ${h.currency || 'USD'}`];
}

// ─── Individual checks ───────────────────────────────────────────────────────

function checkNoFlightCard(text: string): CriticIssue | null {
  if (RE_FLIGHT_CARD.test(text)) {
    return { id: 'no_flight_card_tag', severity: 'error', message: 'Response contains [FLIGHT_CARD] tag — cards are rendered by the UI and must not be echoed.' };
  }
  return null;
}

function checkNoHotelCard(text: string): CriticIssue | null {
  if (RE_HOTEL_CARD.test(text)) {
    return { id: 'no_hotel_card_tag', severity: 'error', message: 'Response contains [HOTEL_CARD] tag — cards are rendered by the UI and must not be echoed.' };
  }
  return null;
}

function checkNoBookingTag(text: string): CriticIssue | null {
  if (RE_BOOKING.test(text)) {
    return { id: 'no_booking_confirmed_tag', severity: 'error', message: 'Response contains a booking-confirmation tag — those are server-side only.' };
  }
  return null;
}

function checkCheapestFlightPrice(text: string, ctx: CriticContext): CriticIssue | null {
  if (!ctx.flightResults?.length) return null;
  const c = cheapest(ctx.flightResults, 'price');
  if (!c) return null;
  const candidates = priceStringsForFlight(c);
  if (candidates.some(s => text.includes(s))) return null;
  return {
    id: 'cheapest_flight_price_present',
    severity: 'warn',
    message: `Response doesn't mention the cheapest flight price (${c.currency ?? 'USD'} ${c.price}) — possible rounding or omission.`,
    detail: { expectedAnyOf: candidates },
  };
}

function checkCheapestHotelPrice(text: string, ctx: CriticContext): CriticIssue | null {
  if (!ctx.hotelResults?.length) return null;
  const c = cheapest(ctx.hotelResults, 'pricePerNight');
  if (!c) return null;
  const candidates = priceStringsForHotel(c);
  if (candidates.some(s => text.includes(s))) return null;
  return {
    id: 'cheapest_hotel_price_present',
    severity: 'warn',
    message: `Response doesn't mention the cheapest hotel price (${c.currency ?? 'USD'} ${c.pricePerNight}/nt) — possible rounding or omission.`,
    detail: { expectedAnyOf: candidates },
  };
}

function checkDotDisclosure(text: string, ctx: CriticContext): CriticIssue | null {
  if (!ctx.flightResults?.length) return null;
  const origin = (ctx.flightOrigin ?? '').toUpperCase();
  if (!US_AIRPORTS.has(origin)) return null;
  if (!ctx.flightDepartureDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (daysBetween(today, ctx.flightDepartureDate) < 7) return null;

  // Look for ANY of the DOT phrases
  const phrases = ['24 hour', '24-hour', '24hr', 'US DOT', 'DOT rule'];
  if (phrases.some(p => text.toLowerCase().includes(p.toLowerCase()))) return null;

  return {
    id: 'dot_24h_disclosure_present',
    severity: 'warn',
    message: `US departure (${origin}) ≥7 days out but response omits DOT 24-hour free-cancellation disclosure.`,
  };
}

function checkServiceFeeMentioned(text: string, ctx: CriticContext): CriticIssue | null {
  const hasFlights = (ctx.flightResults?.length ?? 0) > 0;
  const hasHotels  = (ctx.hotelResults?.length  ?? 0) > 0;
  if (!hasFlights && !hasHotels) return null;
  if (/\$20|\bservice fee\b/i.test(text)) return null;
  return {
    id: 'service_fee_mentioned',
    severity: 'warn',
    message: 'Response with results doesn\'t mention the $20 service fee / call-to-action.',
  };
}

function checkDirectFlightRule(text: string, ctx: CriticContext): CriticIssue | null {
  if (!ctx.flightResults?.length) return null;
  const userMsg = ctx.lastUserMessage.toLowerCase();
  const askedDirect = /\b(non[- ]?stop|direct|no stops|no layovers)\b/.test(userMsg);
  if (!askedDirect) return null;
  const withStops = ctx.flightResults.filter(f => f.stops > 0);
  if (withStops.length === 0) return null;
  return {
    id: 'direct_flight_rule_respected',
    severity: 'error',
    message: `User asked for direct flights but ${withStops.length}/${ctx.flightResults.length} returned flights have stops. maxConnections likely not applied.`,
    detail: { withStopsCount: withStops.length, totalCount: ctx.flightResults.length },
  };
}

function checkResponseLength(text: string): CriticIssue | null {
  // Count sentences by punctuation (approx). Ignore code blocks.
  const clean = text.replace(/```[\s\S]*?```/g, '');
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 3);
  if (sentences.length <= 8) return null;
  return {
    id: 'response_length_reasonable',
    severity: 'warn',
    message: `Response is ${sentences.length} sentences; skill rule suggests ≤5. May indicate rambling.`,
    detail: { sentenceCount: sentences.length },
  };
}

function checkNoPiiAck(text: string, ctx: CriticContext): CriticIssue | null {
  // Only flag if the assistant response itself contains these patterns.
  // The user message can contain them — that's fine; the skill requires
  // Claude to redirect to the booking form, not echo back.
  if (ctx.conversationState !== 'browsing' && ctx.conversationState !== undefined) {
    // Post-selection — higher bar for PII hygiene.
  }
  const hits: string[] = [];
  if (RE_CC_LIKE.test(text))  hits.push('credit-card-like digits');
  if (RE_DOB_LIKE.test(text) && /date of birth|dob|born/i.test(text)) hits.push('DOB acknowledgement');
  if (RE_PASSPORT.test(text)) hits.push('passport reference');
  if (hits.length === 0) return null;
  return {
    id: 'no_pii_acknowledgement',
    severity: 'error',
    message: `Response appears to acknowledge PII: ${hits.join(', ')}. Must redirect to secure booking form.`,
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export function runCritic(text: string, ctx: CriticContext): CriticReport {
  const checks = [
    () => checkNoFlightCard(text),
    () => checkNoHotelCard(text),
    () => checkNoBookingTag(text),
    () => checkCheapestFlightPrice(text, ctx),
    () => checkCheapestHotelPrice(text, ctx),
    () => checkDotDisclosure(text, ctx),
    () => checkServiceFeeMentioned(text, ctx),
    () => checkDirectFlightRule(text, ctx),
    () => checkResponseLength(text),
    () => checkNoPiiAck(text, ctx),
  ];

  const issues: CriticIssue[] = [];
  for (const check of checks) {
    try {
      const r = check();
      if (r) issues.push(r);
    } catch (err) {
      // Never let the critic crash the response. Log and continue.
      console.warn('[critic] check threw:', err);
    }
  }

  return {
    passed:   issues.filter(i => i.severity === 'error').length === 0,
    issues,
    ranCount: checks.length,
  };
}
