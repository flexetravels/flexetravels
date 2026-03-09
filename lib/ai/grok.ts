// ─── Grok (xAI) REST Client ───────────────────────────────────────────────────
// Grok uses the OpenAI-compatible chat completions API
// Docs: https://docs.x.ai/api
// Models: grok-3, grok-3-fast (cheaper), grok-3-mini

const GROK_BASE = 'https://api.x.ai/v1';

interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GrokChatParams {
  model?: string;
  messages: GrokMessage[];
  maxTokens?: number;
  temperature?: number;
}

interface GrokResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function grokChat(params: GrokChatParams): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey || apiKey.includes('PASTE')) {
    throw new Error('GROK_API_KEY not configured');
  }

  const res = await fetch(`${GROK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       params.model ?? 'grok-3-fast',
      messages:    params.messages,
      max_tokens:  params.maxTokens ?? 512,
      temperature: params.temperature ?? 0.3,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Grok API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json() as GrokResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Ask Grok for travel market intelligence on a specific flight or hotel price.
 * Returns concise 2-3 sentence analysis.
 */
export async function grokPriceInsight(
  context: {
    type: 'flight' | 'hotel';
    origin?: string;
    destination: string;
    dates: string;
    price: number;
    currency: string;
    provider: string;
  }
): Promise<string> {
  const prompt = context.type === 'flight'
    ? `A traveler is considering a flight from ${context.origin} to ${context.destination} on ${context.dates} for ${context.currency} ${context.price} per person (from ${context.provider}). Is this a good deal for the North American market? Give a 2-sentence assessment of whether this price is above, at, or below average, and when the best time to book is.`
    : `A traveler is considering a hotel in ${context.destination} for ${context.dates} at ${context.currency} ${context.price}/night (from ${context.provider}). Is this a good rate? Give a 2-sentence assessment of value and any tips to save money.`;

  return grokChat({
    model: 'grok-3-fast',
    messages: [
      { role: 'system', content: 'You are a travel pricing expert with real-time market knowledge. Be concise and practical. Focus on North American traveler perspective.' },
      { role: 'user',   content: prompt },
    ],
    maxTokens: 200,
  });
}
