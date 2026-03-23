import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { EmbeddedCard } from './types';

/** Tailwind class merger */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format price with currency */
export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format ISO date to readable string */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** Format ISO datetime to time string */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/**
 * Airline logo URL via avs.io — served by IATA 2-letter carrier code.
 * Pass the 2-letter IATA code (e.g. "AC", "WS", "UA").
 * Falls back to empty string if no code given (component renders text badge).
 */
export function airlineLogo(iataCode?: string): string {
  if (!iataCode || iataCode.length < 2) return '';
  const code = iataCode.slice(0, 2).toUpperCase();
  return `https://pics.avs.io/64/64/${code}.png`;
}

/**
 * Extract a balanced JSON object starting at `start` index in `text`.
 * Handles nested objects and arrays (unlike [^}]* regex).
 */
function extractBalancedJson(text: string, start: number): string | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse embedded card JSON from assistant message text.
 * Supports [FLIGHT_CARD] {...}, [HOTEL_CARD] {...}, [BOOKING_CONFIRMED] {...}
 * Uses balanced-bracket extraction to handle nested JSON objects/arrays.
 */
export function parseEmbeddedCards(text: string): EmbeddedCard[] {
  const cards: EmbeddedCard[] = [];
  const tagDefs: { tag: string; type: EmbeddedCard['type'] }[] = [
    { tag: 'FLIGHT_CARD',              type: 'flight' },
    { tag: 'HOTEL_CARD',               type: 'hotel' },
    { tag: 'EXPERIENCE_CARD',          type: 'experience' },
    { tag: 'BOOKING_CONFIRMED',        type: 'booking_confirmed' },
    { tag: 'HOTEL_BOOKING_CONFIRMED',  type: 'hotel_booking_confirmed' },
    { tag: 'PAYMENT_REQUIRED',         type: 'payment_required' },
  ];

  for (const { tag, type } of tagDefs) {
    const marker = `[${tag}]`;
    let pos = 0;
    while ((pos = text.indexOf(marker, pos)) !== -1) {
      pos += marker.length;
      // skip whitespace
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      const jsonStr = extractBalancedJson(text, pos);
      if (jsonStr) {
        try {
          const data = JSON.parse(jsonStr);
          cards.push({ type, data } as EmbeddedCard);
        } catch (e) {
          // Malformed JSON from AI — log so we can spot patterns and fix the system prompt
          console.warn(`[parseEmbeddedCards] Failed to parse [${tag}] JSON:`, String(e),
            '\n  First 120 chars:', jsonStr.slice(0, 120));
        }
        pos += jsonStr.length;
      } else if (text.indexOf(`[${tag}]`, pos - marker.length) !== -1) {
        // extractBalancedJson returned null — either not JSON or stream cut off mid-tag
        console.warn(`[parseEmbeddedCards] No balanced JSON found after [${tag}] at pos ${pos}`);
      }
    }
  }

  return cards;
}

/** Strip embedded card tags from text before rendering markdown */
export function stripCardTags(text: string): string {
  const tags = ['FLIGHT_CARD', 'HOTEL_CARD', 'EXPERIENCE_CARD', 'BOOKING_CONFIRMED', 'HOTEL_BOOKING_CONFIRMED', 'PAYMENT_REQUIRED'];
  let result = text;
  for (const tag of tags) {
    const marker = `[${tag}]`;
    let out = '';
    let pos = 0;
    while (true) {
      const idx = result.indexOf(marker, pos);
      if (idx === -1) { out += result.slice(pos); break; }
      out += result.slice(pos, idx);
      let j = idx + marker.length;
      while (j < result.length && /\s/.test(result[j])) j++;
      if (result[j] === '{') {
        const json = extractBalancedJson(result, j);
        if (json) { pos = j + json.length; continue; }
        // Incomplete JSON — stream is mid-card; hide everything from here onwards
        // so raw partial JSON never appears as text while the AI is still typing
        break;
      }
      pos = j;
    }
    result = out;
  }
  return result.trim();
}

/** Generate a short session ID */
export function generateSessionId(): string {
  return Math.random().toString(36).slice(2, 10) +
         Date.now().toString(36);
}

/**
 * Compress message history before sending to the AI to stay within token limits.
 *
 * Strategy:
 * - Keep the last KEEP_FULL messages verbatim (so recent context is intact).
 * - In older messages, replace [*_CARD] {...large JSON...} with a compact
 *   placeholder so the AI knows results were shown, without re-sending all data.
 * - Also strip partial/streaming card JSON that never completed.
 *
 * This typically saves 3,000–8,000 tokens per request on active conversations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compressMessageHistory<T extends Record<string, any>>(
  messages: T[],
  keepFull = 6,
): T[] {
  if (messages.length <= keepFull) return messages;

  const CARD_TAGS = [
    'FLIGHT_CARD', 'HOTEL_CARD', 'EXPERIENCE_CARD',
    'BOOKING_CONFIRMED', 'HOTEL_BOOKING_CONFIRMED', 'PAYMENT_REQUIRED',
  ];

  // Build a single regex that matches any card tag + its JSON payload
  // Matches: [TAG_NAME] { ... } including nested braces
  const compressContent = (text: string): string => {
    let result = text;
    for (const tag of CARD_TAGS) {
      const marker = `[${tag}]`;
      let out = '';
      let pos = 0;
      while (true) {
        const idx = result.indexOf(marker, pos);
        if (idx === -1) { out += result.slice(pos); break; }
        out += result.slice(pos, idx);
        let j = idx + marker.length;
        // skip whitespace
        while (j < result.length && /\s/.test(result[j])) j++;
        if (result[j] === '{') {
          // walk balanced braces
          let depth = 0; let inStr = false; let esc = false;
          let k = j;
          for (; k < result.length; k++) {
            const ch = result[k];
            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { k++; break; } }
          }
          // Replace the full [TAG] {...} with a tiny stub
          out += `[${tag}_SHOWN]`;
          pos = k;
        } else {
          out += marker;
          pos = j;
        }
      }
      result = out;
    }
    return result;
  };

  return messages.map((msg, i): T => {
    // Keep the last `keepFull` messages untouched
    if (i >= messages.length - keepFull) return msg;
    if (typeof msg.content !== 'string') return msg;
    const compressed = compressContent(msg.content);
    if (compressed === msg.content) return msg;
    return { ...msg, content: compressed };
  });
}

/** Get star rating display */
export function starsArray(count: number): string[] {
  return Array.from({ length: 5 }, (_, i) =>
    i < Math.floor(count) ? 'full' : i < count ? 'half' : 'empty'
  );
}

/** Detect /command in input string */
export function detectCommand(input: string): string | null {
  const match = input.match(/^(\/[a-z-]+(?:-\d+)?)\b/i);
  return match ? match[1] : null;
}

/** Quick-reply presets */
export const QUICK_REPLIES = [
  { label: '🏖️ Beach escape',     message: "I want a relaxing beach vacation for 2" },
  { label: '🗺️ Adventure trip',   message: "Plan an adventure trip for me" },
  { label: '🏯 Cultural tour',    message: "I'd love a cultural city tour in Asia" },
  { label: '💰 Budget travel',    message: "Best budget destinations for under $1500" },
  { label: '🌙 Honeymoon',       message: "Help me plan a romantic honeymoon trip" },
  { label: '👨‍👩‍👧 Family trip',     message: "Plan a family-friendly trip for 2 adults + 2 kids" },
] as const;
