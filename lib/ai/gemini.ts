// ─── Google Gemini REST Client ────────────────────────────────────────────────
// Uses the Gemini generativelanguage REST API (no SDK needed)
// Docs: https://ai.google.dev/api/rest
// Models: gemini-2.0-flash (fast, cheap), gemini-2.0-pro

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: GeminiPart[] };
    finishReason: string;
  }>;
  usageMetadata?: { totalTokenCount: number };
}

export async function geminiGenerate(
  prompt: string,
  systemInstruction?: string,
  model = 'gemini-2.0-flash',
  options?: { maxOutputTokens?: number; temperature?: number }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('PASTE')) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const body: {
    contents: GeminiContent[];
    systemInstruction?: { parts: GeminiPart[] };
    generationConfig: { maxOutputTokens: number; temperature: number };
  } = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: options?.maxOutputTokens ?? 512,
      temperature:     options?.temperature     ?? 0.4,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json() as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Ask Gemini for destination travel tips — best time to visit, neighbourhoods,
 * hidden gems, travel warnings. Returns structured markdown.
 */
export async function geminiDestinationGuide(
  destination: string,
  travelDates?: string,
  interests?: string[]
): Promise<string> {
  const dateContext = travelDates ? ` for travel around ${travelDates}` : '';
  const interestContext = interests?.length
    ? ` The traveler is interested in: ${interests.join(', ')}.`
    : '';

  const prompt = `Give a brief travel guide for ${destination}${dateContext}.${interestContext}

  Include:
  1. Best neighbourhoods to stay (2-3 options)
  2. Must-do activities (3-4 items)
  3. Local food to try (2-3 items)
  4. Practical travel tip (1 item)
  5. Any current travel advisories for North American visitors

  Keep it concise — 150 words max. Format as a clean markdown list.`;

  return geminiGenerate(
    prompt,
    'You are a knowledgeable travel guide specializing in helping North American tourists. Be concise, practical, and current.',
  );
}

/**
 * Ask Gemini to suggest alternative destinations based on user preferences.
 */
export async function geminiAlternatives(
  originalDestination: string,
  budget: number,
  interests: string,
  departureCity: string
): Promise<string> {
  const prompt = `A traveler from ${departureCity} wants to visit ${originalDestination} with a budget of ~$${budget} USD.
  Their interests: ${interests}.

  Suggest 3 alternative destinations they might love just as much, that may be better value or easier to reach from ${departureCity} in North America.
  For each: name, why it's similar, approximate flight time from ${departureCity}, and rough cost comparison.
  Keep it to 120 words total.`;

  return geminiGenerate(
    prompt,
    'You are a creative travel advisor. Suggest destinations that are genuinely good alternatives, not just random popular places.',
  );
}
