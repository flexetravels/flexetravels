// ─── Agent Session State ────────────────────────────────────────────────────
// Tiny, process-local memory the chat agent reads/writes across turns.
// Fixes two classes of bug:
//   1. Filter drops on retry  — Claude re-calls searchFlights without the
//      user's avoidAirlines / cabinClass / etc. after a failed first attempt.
//   2. History-compression loss — lib/utils.ts compresses all but the last
//      six messages; constraints mentioned early get silently dropped.
//
// Design goals:
//   • Additive — empty state ⇒ zero behavior change vs. today.
//   • Cheap — one Map, no DB writes in the hot path, bounded at 2000 entries
//     with 4h TTL so a runaway loop can't balloon memory.
//   • Tool-params-win — stored constraints only fill in UNDEFINED fields on a
//     tool call. A tool that explicitly passes `avoidAirlines: []` overrides
//     memory; a tool that omits the field gets it filled in from memory.
//   • No persistence — if the Node process restarts, sessions reset. Critical
//     booking data already lives in Supabase (user_sessions / bookings) and
//     is not duplicated here.
//
// Why not Supabase / Redis? A single Railway instance serves every chat
// request, so a process-local Map is correct. If we ever scale out to
// multiple replicas, swap the store for Redis behind the same interface.

// ── Types ──────────────────────────────────────────────────────────────────

export interface TripConstraints {
  // Pax
  adults?:        number;
  childrenAges?:  number[];
  infants?:       number;

  // Flight filters — mirror the Zod schema in searchFlights
  cabinClass?:         'economy' | 'premium_economy' | 'business' | 'first';
  avoidAirlines?:      string[];
  maxConnections?:     number;
  viaRegions?:         Array<'pacific' | 'europe' | 'middleeast'>;
  maxPrice?:           number;
  maxDurationMinutes?: number;
  departAfter?:        string;
  departBefore?:       string;

  // Hotel filters — mirror the Zod schema in searchHotels
  hotelStars?:             number;
  hotelMinRating?:         number;
  hotelMinReviewCount?:    number;
  hotelAmenities?:         string[];
  hotelBoardType?:         'RO' | 'BB' | 'HB' | 'FB' | 'AI';
  hotelFreeCancellation?:  boolean;
  hotelMaxPricePerNight?:  number;

  // Free-form notes the assistant may record but no tool enforces directly
  dietary?:   string;
  mobility?:  string;
  notes?:     string;
}

export interface ChosenFlight {
  offerId:      string;
  airline:      string;
  origin:       string;
  destination:  string;
  departure:    string;   // ISO
  arrival:      string;   // ISO
  priceUSD:     number;
  currency:     string;
}

export interface ChosenHotel {
  rateId:    string;
  name:      string;
  city:      string;
  checkIn:   string;      // YYYY-MM-DD
  checkOut:  string;
  priceUSD:  number;
  currency:  string;
}

export interface SessionState {
  sessionId:     string;
  createdAt:     number;
  updatedAt:     number;
  constraints:   TripConstraints;
  chosenFlight?: ChosenFlight;
  chosenHotel?:  ChosenHotel;
}

// ── Store ──────────────────────────────────────────────────────────────────

const TTL_MS      = 4 * 60 * 60 * 1000;   // 4h — longer than a typical planning session
const MAX_ENTRIES = 2_000;
const store = new Map<string, SessionState>();

function touch(state: SessionState): SessionState {
  state.updatedAt = Date.now();
  return state;
}

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Drop expired first (O(n) but n is bounded + runs rarely)
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.updatedAt > TTL_MS) store.delete(k);
  }
  // If still too big, drop the single oldest. No O(n log n) sort — this only
  // runs when we're over cap and evicting one entry per store() call.
  while (store.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt  = Infinity;
    for (const [k, v] of store) {
      if (v.updatedAt < oldestAt) { oldestAt = v.updatedAt; oldestKey = k; }
    }
    if (oldestKey === null) break;
    store.delete(oldestKey);
  }
}

/** Get (or lazily create) the session-state blob for a sessionId. */
export function getSessionState(sessionId: string): SessionState {
  const existing = store.get(sessionId);
  if (existing && Date.now() - existing.updatedAt < TTL_MS) return existing;
  const fresh: SessionState = {
    sessionId,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    constraints: {},
  };
  store.set(sessionId, fresh);
  evictIfNeeded();
  return fresh;
}

// ── Mutators ───────────────────────────────────────────────────────────────

/**
 * Merge a partial constraints patch into state. Only DEFINED, NON-NULL fields
 * in the patch overwrite — undefined/null fields are treated as "unchanged".
 */
export function mergeConstraints(
  sessionId: string,
  patch: Partial<TripConstraints>,
): SessionState {
  const s = getSessionState(sessionId);
  for (const k of Object.keys(patch) as Array<keyof TripConstraints>) {
    const v = patch[k];
    if (v === undefined || v === null) continue;
    // Ignore empty strings and empty arrays — they usually mean "not set"
    if (typeof v === 'string' && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (s.constraints as Record<string, unknown>)[k] = v;
  }
  return touch(s);
}

/** Delete one constraint field — used for "actually I'm fine with Air India". */
export function clearConstraint(
  sessionId: string,
  key:       keyof TripConstraints,
): SessionState {
  const s = getSessionState(sessionId);
  delete s.constraints[key];
  return touch(s);
}

export function setChosenFlight(sessionId: string, chosen?: ChosenFlight): SessionState {
  const s = getSessionState(sessionId);
  s.chosenFlight = chosen;
  return touch(s);
}

export function setChosenHotel(sessionId: string, chosen?: ChosenHotel): SessionState {
  const s = getSessionState(sessionId);
  s.chosenHotel = chosen;
  return touch(s);
}

// ── Merge helpers for tool executors ───────────────────────────────────────

const FLIGHT_MERGE_FIELDS: Array<keyof TripConstraints> = [
  'cabinClass', 'avoidAirlines', 'maxConnections', 'viaRegions',
  'maxPrice',   'maxDurationMinutes', 'departAfter', 'departBefore',
  'adults',     'childrenAges', 'infants',
];

/**
 * Merge stored flight constraints into a searchFlights params object. Fields
 * explicitly set on `params` ALWAYS win; memory only fills in undefined slots.
 * Returns a shallow-cloned object — the input is not mutated.
 */
export function mergeFlightParams<P extends Record<string, unknown>>(
  sessionId: string,
  params:    P,
): P {
  const base = getSessionState(sessionId).constraints;
  const out: Record<string, unknown> = { ...params };
  for (const k of FLIGHT_MERGE_FIELDS) {
    if (out[k] === undefined && base[k] !== undefined) {
      out[k] = base[k];
    }
  }
  return out as P;
}

/**
 * searchFlights filter fields → TripConstraints keys are identical, so
 * this is a straight copy of the params with only the constraint-relevant
 * keys preserved. Called after a successful search to capture what Claude
 * asked for as the new baseline.
 */
export function extractFlightConstraints(params: Record<string, unknown>): Partial<TripConstraints> {
  const out: Partial<TripConstraints> = {};
  for (const k of FLIGHT_MERGE_FIELDS) {
    const v = params[k];
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Merge stored hotel constraints into searchHotels params. The hotel tool
 * uses different field names than TripConstraints (stars, minRating, etc.),
 * so this function maps TripConstraints.hotelStars → params.stars and so on.
 */
export function mergeHotelParams<P extends Record<string, unknown>>(
  sessionId: string,
  params:    P,
): P {
  const base = getSessionState(sessionId).constraints;
  const out: Record<string, unknown> = { ...params };
  if (out.stars            === undefined && base.hotelStars            !== undefined) out.stars            = base.hotelStars;
  if (out.minRating        === undefined && base.hotelMinRating        !== undefined) out.minRating        = base.hotelMinRating;
  if (out.minReviewCount   === undefined && base.hotelMinReviewCount   !== undefined) out.minReviewCount   = base.hotelMinReviewCount;
  if (out.amenities        === undefined && base.hotelAmenities        !== undefined) out.amenities        = base.hotelAmenities;
  if (out.boardType        === undefined && base.hotelBoardType        !== undefined) out.boardType        = base.hotelBoardType;
  if (out.freeCancellation === undefined && base.hotelFreeCancellation !== undefined) out.freeCancellation = base.hotelFreeCancellation;
  if (out.maxPrice         === undefined && base.hotelMaxPricePerNight !== undefined) out.maxPrice         = base.hotelMaxPricePerNight;
  if (out.adults           === undefined && base.adults                !== undefined) out.adults           = base.adults;
  if (out.childrenAges     === undefined && base.childrenAges          !== undefined) out.childrenAges     = base.childrenAges;
  return out as P;
}

/** Extract hotel-side constraints from a searchHotels params blob. */
export function extractHotelConstraints(params: Record<string, unknown>): Partial<TripConstraints> {
  const out: Partial<TripConstraints> = {};
  if (params.stars            !== undefined) out.hotelStars            = params.stars            as number;
  if (params.minRating        !== undefined) out.hotelMinRating        = params.minRating        as number;
  if (params.minReviewCount   !== undefined) out.hotelMinReviewCount   = params.minReviewCount   as number;
  if (params.amenities        !== undefined) out.hotelAmenities        = params.amenities        as string[];
  if (params.boardType        !== undefined) out.hotelBoardType        = params.boardType        as TripConstraints['hotelBoardType'];
  if (params.freeCancellation !== undefined) out.hotelFreeCancellation = params.freeCancellation as boolean;
  if (params.maxPrice         !== undefined) out.hotelMaxPricePerNight = params.maxPrice         as number;
  if (params.adults           !== undefined) out.adults                = params.adults           as number;
  if (params.childrenAges     !== undefined) out.childrenAges          = params.childrenAges     as number[];
  return out;
}

// ── System-prompt injection ────────────────────────────────────────────────

/**
 * Render a short human-readable summary of currently-active constraints for
 * the system prompt. Empty string when no constraints are set — in that case
 * the caller should skip the injection entirely so the prompt stays identical
 * to today for fresh sessions.
 */
export function formatConstraintSummary(sessionId: string): string {
  const s = store.get(sessionId);
  if (!s) return '';
  const c = s.constraints;
  const parts: string[] = [];

  // Pax
  if (c.adults || c.childrenAges?.length || c.infants) {
    const bits: string[] = [];
    if (c.adults)                 bits.push(`${c.adults} adult${c.adults > 1 ? 's' : ''}`);
    if (c.childrenAges?.length)   bits.push(`${c.childrenAges.length} child (ages ${c.childrenAges.join(',')})`);
    if (c.infants)                bits.push(`${c.infants} infant${c.infants > 1 ? 's' : ''}`);
    parts.push(`Pax: ${bits.join(' + ')}`);
  }
  if (c.cabinClass)                  parts.push(`Cabin: ${c.cabinClass}`);
  if (c.avoidAirlines?.length)       parts.push(`Avoid airlines: [${c.avoidAirlines.join(', ')}]`);
  if (c.maxConnections !== undefined)parts.push(`Max connections: ${c.maxConnections}`);
  if (c.viaRegions?.length)          parts.push(`Via: ${c.viaRegions.join(', ')}`);
  if (c.maxPrice)                    parts.push(`Max flight: $${c.maxPrice}`);
  if (c.maxDurationMinutes)          parts.push(`Max trip duration: ${c.maxDurationMinutes}min`);
  if (c.departAfter)                 parts.push(`Depart after ${c.departAfter}`);
  if (c.departBefore)                parts.push(`Depart before ${c.departBefore}`);
  if (c.hotelStars)                  parts.push(`Hotel: ≥${c.hotelStars}★`);
  if (c.hotelMinRating)              parts.push(`Hotel rating ≥${c.hotelMinRating}`);
  if (c.hotelAmenities?.length)      parts.push(`Hotel amenities: [${c.hotelAmenities.join(', ')}]`);
  if (c.hotelBoardType)              parts.push(`Board: ${c.hotelBoardType}`);
  if (c.hotelFreeCancellation)       parts.push(`Hotel: free cancellation`);
  if (c.hotelMaxPricePerNight)       parts.push(`Hotel ≤$${c.hotelMaxPricePerNight}/night`);
  if (c.dietary)                     parts.push(`Dietary: ${c.dietary}`);
  if (c.mobility)                    parts.push(`Mobility: ${c.mobility}`);
  if (c.notes)                       parts.push(`Notes: ${c.notes}`);

  if (s.chosenFlight) {
    parts.push(`Chosen flight: ${s.chosenFlight.airline} ${s.chosenFlight.origin}→${s.chosenFlight.destination} @ ${s.chosenFlight.currency} ${s.chosenFlight.priceUSD}`);
  }
  if (s.chosenHotel) {
    parts.push(`Chosen hotel: ${s.chosenHotel.name} (${s.chosenHotel.checkIn}→${s.chosenHotel.checkOut})`);
  }

  return parts.join(' | ');
}

// ── Test-only helpers ──────────────────────────────────────────────────────

/** For tests only — wipe the store. Not exported via a stable API. */
export function __resetStoreForTests(): void { store.clear(); }
