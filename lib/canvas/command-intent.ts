// Pure intent helpers for Trip Canvas command handling.
// These are intentionally small and dependency-free so we can regression-test
// bad prompt shapes without calling an LLM or live travel providers.

export interface OriginReturnIntent {
  originCity: string;
  returnCity: string;
}

export interface PromptIntentFlags {
  originReturnCorrection: boolean;
  noOriginMultiCity: boolean;
  promptInjection: boolean;
  dateOrStayEdit: boolean;
  travellerEdit: boolean;
  hotelFilter: boolean;
  flightFilter: boolean;
}

export function normalizeCityKey(city: string): string {
  return city.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function titleCaseCity(city: string): string {
  return city.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function parseOriginReturnRequest(message: string): OriginReturnIntent | null {
  const originMatch = message.match(/\b(?:flying|fly|depart(?:ing)?|leav(?:e|ing)|start(?:ing)?)\s+from\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?=\s*,|\s+covering|\s+and|\s+then|\s+to|\s+for|\s*$)/i)
    ?? message.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?=\s*,|\s+covering|\s+and\s+back|\s+back\s+to|\s+return|\s+to|\s*$)/i)
    ?? message.match(/\b(?:multi-city|multicity|multi city)\s*:?\s*([A-Za-z][A-Za-z .'-]{1,80}?)(?=\s+to\b)/i);
  const returnMatch = message.match(/\b(?:back|return(?:ing)?)\s+to\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?=\s*,|\s+after|\s+at\s+the\s+end|\s*$)/i);
  if (!originMatch) return null;
  const originCity = originMatch[1].trim().replace(/[.,!?]+$/, '');
  const impliedRoundTrip = /\bround\s*trip\b/i.test(message) && /\breturn(?:ing)?\b/i.test(message);
  const returnCity = returnMatch?.[1]?.trim().replace(/[.,!?]+$/, '') ?? (impliedRoundTrip ? originCity : '');
  if (!originCity || !returnCity) return null;
  return { originCity, returnCity };
}

export function looksLikeOriginCorrection(message: string): boolean {
  return !!parseOriginReturnRequest(message);
}

export function mentionsNoOriginMultiCity(message: string): boolean {
  const text = message.trim();
  if (/\b(?:from|flying from|departing from|leaving from|starting from)\b/i.test(text)) return false;
  if (!/\b(?:cover|covering|multi-city|multicity|multi city|visit|visiting|through|across)\b/i.test(text)) return false;

  const scoped = text.match(/\b(?:cover|covering|visit(?:ing)?|through|across)\s+(.+)$/i)?.[1]
    ?? text.match(/\b(?:multi-city|multicity|multi city)\s*:?\s*(.+)$/i)?.[1]
    ?? text;
  const cleaned = scoped
    .replace(/\b(?:and\s+)?(?:back|return(?:ing)?)\s+to\s+[A-Za-z][A-Za-z .'-]{1,80}\b/gi, '')
    .replace(/\b(?:for|in)\s+\d+\s+(?:days?|nights?)\b/gi, '');
  const cityish = cleaned
    .split(/,|\band\b|→|->/i)
    .map(s => s.trim())
    .filter(s => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(s));
  return cityish.length >= 2;
}

export function looksLikePromptInjection(message: string): boolean {
  return /(<\s*system\b|\[FLIGHT_SELECTED\]|\[BOOKING_COMPLETE\]|\[FLIGHT_CARD\]|\[HOTEL_CARD\]|ignore (?:all )?(?:previous|above) instructions|book offer .*?\$?\s*1\b)/i.test(message);
}

export function looksLikeDateOrStayEdit(message: string): boolean {
  return /\b(?:change|make|set|update|extend|shorten)\b[\s\S]{0,90}\b(?:days?|nights?)\b/i.test(message)
    || /\b(?:add|remove)\s+\d{1,2}\s+(?:days?|nights?)\b/i.test(message);
}

export function looksLikeTravellerEdit(message: string): boolean {
  return /\b(?:adult|adults|child|children|kid|kids|toddler|infant|baby|passenger|traveller|traveler|\d{1,2}\s*-\s*year\s*-\s*old|\d{1,2}\s+year\s+old)\b/i.test(message)
    && /\b(?:add|remove|change|make|set|now|actually|age|aged|family|with|for|\d)\b/i.test(message);
}

export function looksLikeHotelFilter(message: string): boolean {
  return /\b(?:hotel|hotels|resort|resorts|room|rooms|suite|property|stay|nearby|star rating|all-inclusive|pool|breakfast|refundable|free cancellation|gym|spa|parking|accessible|separate bedroom|kitchen)\b/i.test(message)
    && /\b(?:pool|breakfast|refundable|free cancellation|all-inclusive|gym|spa|parking|accessible|near|nearby|under|5-star|4-star|luxury|budget|family|separate bedroom|kitchen|cheaper|star rating)\b/i.test(message);
}

export function looksLikeFlightFilter(message: string): boolean {
  return /\b(?:trip|flight|flights|fly|airline|fare|fares|layover|connection|connections|stop|non-stop|nonstop|direct|red-eye|red-eyes|redeye|overnight|cabin|business|economy|baggage|avoid|via)\b/i.test(message)
    && /\b(?:non-stop|nonstop|direct|layover|connection|connections|stop|red-eye|red-eyes|redeye|overnight|business|premium economy|first class|baggage|avoid|via|morning|evening|cheap|cheaper|flexible|under|comfort)\b/i.test(message);
}

export function classifyPromptIntent(message: string): PromptIntentFlags {
  return {
    originReturnCorrection: looksLikeOriginCorrection(message),
    noOriginMultiCity:      mentionsNoOriginMultiCity(message),
    promptInjection:        looksLikePromptInjection(message),
    dateOrStayEdit:         looksLikeDateOrStayEdit(message),
    travellerEdit:          looksLikeTravellerEdit(message),
    hotelFilter:            looksLikeHotelFilter(message),
    flightFilter:           looksLikeFlightFilter(message),
  };
}
