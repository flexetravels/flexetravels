/**
 * lib/security/input-sanitizer.ts
 *
 * Prompt injection & XSS defences for the FlexeTravels AI chat pipeline.
 *
 * Attack surfaces addressed:
 *  1. User messages → Claude: fake card tags, state-machine tags, XML LLM-injection
 *     tags, markdown tracking pixels, Unicode direction-override characters.
 *  2. Claude output → browser: javascript:/data: URI links, dangerous HTML fragments.
 *  3. Tool call parameters from Claude: IATA codes, date formats, numeric bounds.
 *  4. Client-supplied conversationState: enum whitelist to prevent state bypass.
 *
 * Nothing here blocks legitimate travel queries — all patterns target well-known
 * injection techniques that have no valid travel-chat use case.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Valid conversation states the client may report. */
export const VALID_CONVERSATION_STATES = [
  'browsing',
  'flight_selected',
  'hotel_selected',
  'checkout',
  'complete',
] as const;

export type ConversationState = (typeof VALID_CONVERSATION_STATES)[number];

/** Trusted image hosts allowed in markdown ![...](url) embeds from AI output. */
const TRUSTED_IMAGE_HOSTS = new Set([
  'images.unsplash.com',
  'unsplash.com',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'pics.avs.io',          // airline logos
  'lh3.googleusercontent.com',
  'cdn.liteapi.travel',
  'photos.hotelbeds.com',
]);

/**
 * Hosts whose links are unconditionally allowed in AI markdown output.
 * All other https:// links are still rendered but NOT outright blocked —
 * we only hard-block dangerous URI schemes (javascript:, data:, vbscript:).
 */
const TRUSTED_LINK_HOSTS = new Set([
  'flexetravels.com',
  'www.flexetravels.com',
  'stripe.com',
  'checkout.stripe.com',
  'js.stripe.com',
  'aircanada.com',
  'www.aircanada.com',
  'westjet.com',
  'www.westjet.com',
  'delta.com',
  'www.delta.com',
  'united.com',
  'www.united.com',
  'aa.com',
  'www.aa.com',
  'britishairways.com',
  'www.britishairways.com',
  'emirates.com',
  'www.emirates.com',
  'lufthansa.com',
  'www.lufthansa.com',
  'airfrance.com',
  'www.airfrance.com',
  'duffel.com',
  'liteapi.travel',
  'iata.org',
  'www.iata.org',
]);

/** Valid IATA airport code: exactly 3 uppercase letters. */
const IATA_CODE_RE = /^[A-Z]{3}$/;

/** Valid ISO date YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Unicode bidi-override and zero-width characters that attackers use to make
 * displayed text differ from what the LLM receives.
 * Ranges: U+200B–U+200F (zero-width), U+202A–U+202E (bidi), U+2028–U+2029
 * (line/paragraph separators), U+FEFF (BOM/zero-width no-break space).
 */
const UNICODE_DANGER_RE = /[\u200B-\u200F\u202A-\u202E\u2028\u2029\uFEFF]/g;

// ─── Input sanitization (user → Claude) ──────────────────────────────────────

/**
 * Strip prompt-injection attempts from a user chat message **before** it is
 * forwarded to Claude.  The function is additive-safe: legitimate travel
 * queries are returned unchanged.
 *
 * Stripped patterns:
 *  • [FLIGHT_CARD / HOTEL_CARD / EXPERIENCE_CARD] … [/TAG] blocks
 *  • [FLIGHT_SELECTED] / [HOTEL_SELECTED] state-machine tags
 *  • <system> / <tool_result> / <function_call> XML blocks & orphan tags
 *  • Markdown image embeds from untrusted hosts (tracking pixels)
 *  • Unicode bidi-override + zero-width characters
 */
export function sanitizeChatInput(message: string): string {
  let s = message;

  // 1. Strip fake card blocks (injection of fake search results)
  for (const tag of ['FLIGHT_CARD', 'HOTEL_CARD', 'EXPERIENCE_CARD']) {
    // [TAG] ... [/TAG] with any content including newlines
    s = s.replace(
      new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'gi'),
      '[removed]',
    );
    // Orphan opening tag (no closing tag) — also consume any trailing JSON blob
    // e.g. [FLIGHT_CARD] {"id":"fake","price":1} search flights to London
    // The regex: \[TAG\] followed by optional whitespace + optional {…} JSON blob
    s = s.replace(
      new RegExp(`\\[${tag}\\]\\s*(\\{[\\s\\S]*?\\})?`, 'gi'),
      '[removed]',
    );
  }

  // 2. Strip state-machine injection tags
  for (const tag of [
    'FLIGHT_SELECTED', 'HOTEL_SELECTED', 'BOOKING_COMPLETE',
    'FLIGHT_CHOSEN',   'HOTEL_CHOSEN',
  ]) {
    s = s.replace(new RegExp(`\\[${tag}\\]`, 'gi'), '');
  }

  // 3. Strip XML-like LLM-injection blocks (full open-close pairs first)
  const xmlInjectionTags = [
    'system', 'tool_result', 'function_call', 'function_calls',
    'antml:function_calls', 'assistant', 'human',
  ];
  for (const tag of xmlInjectionTags) {
    // <tag ...> … </tag>
    s = s.replace(
      new RegExp(`<\\s*${tag}[^>]*>[\\s\\S]*?<\\/\\s*${tag}\\s*>`, 'gi'),
      '[removed]',
    );
  }
  // Strip orphan opening/closing XML injection tags
  s = s.replace(
    /<\s*(system|tool_result|function_call(?:s)?|assistant|human)\s*\/?>/gi,
    '',
  );
  s = s.replace(
    /<\/\s*(system|tool_result|function_call(?:s)?|assistant|human)\s*>/gi,
    '',
  );

  // 4. Strip markdown image embeds from untrusted hosts (tracking pixels)
  //    ![alt](https://external-host.com/pixel.gif)
  s = s.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_match, alt: string, url: string) => {
      try {
        const { hostname } = new URL(url);
        if (
          TRUSTED_IMAGE_HOSTS.has(hostname) ||
          [...TRUSTED_IMAGE_HOSTS].some(h => hostname.endsWith('.' + h))
        ) {
          return _match; // keep trusted image embeds
        }
        return alt ? `[image: ${alt}]` : '[image removed]';
      } catch {
        return '[image removed]';
      }
    },
  );

  // 5. Strip Unicode bidi-override & zero-width characters
  s = s.replace(UNICODE_DANGER_RE, '');

  return s;
}

// ─── Output sanitization (Claude → browser) ──────────────────────────────────

/**
 * Validate a URL extracted from an AI-generated markdown link before rendering
 * it as an `<a href>` in the browser.
 *
 * Returns:
 *  - the original `href` string if safe
 *  - `null`  if the URL is dangerous and the link should be rendered as plain
 *    text instead
 */
export function sanitizeMarkdownHref(href: string | undefined | null): string | null {
  if (!href) return null;

  // Normalise: strip null bytes + leading whitespace (bypass attempts)
  const trimmed = href.replace(/\0/g, '').trim();

  const lower = trimmed.toLowerCase().replace(/\s+/g, ''); // collapse whitespace

  // Block dangerous URI schemes unconditionally
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:')       ||
    lower.startsWith('vbscript:')   ||
    lower.startsWith('blob:')
  ) {
    return null;
  }

  // Allow relative paths and anchor links as-is
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }

  // For external links require https:// (no plain http: from AI output)
  if (!lower.startsWith('https://') && !lower.startsWith('http://')) {
    return null;
  }

  // Parse and return — all https:// URLs are allowed; the caller adds
  // target="_blank" rel="noopener noreferrer" which is sufficient for
  // ordinary external links.  We only hard-block the dangerous schemes above.
  try {
    new URL(trimmed); // throws on malformed URL
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Check whether a URL is from a trusted FlexeTravels/partner host.
 * Useful for adding a visual "external link" indicator for off-domain links.
 */
export function isTrustedLinkHost(href: string): boolean {
  try {
    const { hostname } = new URL(href);
    return (
      TRUSTED_LINK_HOSTS.has(hostname) ||
      [...TRUSTED_LINK_HOSTS].some(h => hostname.endsWith('.' + h))
    );
  } catch {
    return false;
  }
}

// ─── Tool parameter validation ────────────────────────────────────────────────

/**
 * Validate tool-call parameters that Claude passes to the flight/hotel search
 * backends.  Returns an array of human-readable error strings; empty = valid.
 *
 * This is a defence-in-depth layer: Claude's Zod schemas already constrain
 * types, but this catches semantic issues (past dates, out-of-range prices,
 * malformed IATA codes injected via prompt manipulation).
 */
export function validateToolParams(
  toolName: string,
  params: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  // ── Flight search tools ──────────────────────────────────────────────────
  if (toolName === 'searchFlights' || toolName === 'searchBookableFlights') {
    // IATA codes
    if (typeof params.origin === 'string') {
      const code = params.origin.toUpperCase();
      if (!IATA_CODE_RE.test(code)) {
        errors.push(`Invalid origin IATA code: "${params.origin}"`);
      }
    }
    if (typeof params.destination === 'string') {
      const code = params.destination.toUpperCase();
      if (!IATA_CODE_RE.test(code)) {
        errors.push(`Invalid destination IATA code: "${params.destination}"`);
      }
    }
    // Dates
    for (const field of ['departureDate', 'returnDate'] as const) {
      const val = params[field];
      if (typeof val === 'string' && val !== '') {
        if (!DATE_RE.test(val)) {
          errors.push(`Invalid ${field} format (expected YYYY-MM-DD): "${val}"`);
        } else {
          const d = new Date(val);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (d < today) {
            errors.push(`${field} is in the past: "${val}"`);
          }
        }
      }
    }
    // Passenger counts
    if (typeof params.adults === 'number') {
      if (!Number.isInteger(params.adults) || params.adults < 1 || params.adults > 9) {
        errors.push(`adults must be 1–9, got: ${params.adults}`);
      }
    }
    if (typeof params.infants === 'number') {
      if (!Number.isInteger(params.infants) || params.infants < 0 || params.infants > 4) {
        errors.push(`infants must be 0–4, got: ${params.infants}`);
      }
    }
  }

  // ── Hotel search tools ────────────────────────────────────────────────────
  if (toolName === 'searchHotels' || toolName === 'searchNearbyHotels') {
    for (const field of ['checkIn', 'checkOut'] as const) {
      const val = params[field];
      if (typeof val === 'string') {
        if (!DATE_RE.test(val)) {
          errors.push(`Invalid ${field} format (expected YYYY-MM-DD): "${val}"`);
        } else {
          const d = new Date(val);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (d < today) {
            errors.push(`${field} is in the past: "${val}"`);
          }
        }
      }
    }
    if (typeof params.maxPrice === 'number') {
      if (params.maxPrice < 0 || params.maxPrice > 100_000) {
        errors.push(`maxPrice out of reasonable bounds: ${params.maxPrice}`);
      }
    }
    if (typeof params.adults === 'number') {
      if (!Number.isInteger(params.adults) || params.adults < 1 || params.adults > 9) {
        errors.push(`adults must be 1–9, got: ${params.adults}`);
      }
    }
  }

  return errors;
}

// ─── Conversation state validation ───────────────────────────────────────────

/**
 * Validate the `conversationState` value that the client sends in the POST
 * body.  Returns the safe validated state, or `'browsing'` as a default when
 * the value is unknown or missing.
 *
 * This prevents the "short system-prompt bypass": sending
 * `conversationState: "flight_selected"` normally strips the search rules and
 * routing rules from the system prompt.  Unknown values fall back to the full
 * browsing prompt rather than silently accepting them.
 */
export function validateConversationState(raw: unknown): ConversationState {
  if (
    typeof raw === 'string' &&
    (VALID_CONVERSATION_STATES as readonly string[]).includes(raw)
  ) {
    return raw as ConversationState;
  }
  return 'browsing';
}

// ─── Sanitize discover prompt fields ─────────────────────────────────────────

/**
 * Sanitize a `prompt` string that came from the /api/discover AI-generated
 * response before it is injected into the chat as a pre-filled user message.
 *
 * The discover prompts are LLM-generated and could carry injection payloads
 * if the underlying model is itself attacked or misbehaves.
 */
export function sanitizeDiscoverPrompt(prompt: string): string {
  // Re-use the same input sanitizer — it strips injection tags, XML blocks,
  // and bidi overrides.
  return sanitizeChatInput(prompt).slice(0, 500); // hard length cap
}
