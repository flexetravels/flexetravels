// ─── Travel Guide & Discovery AI (Claude Haiku) ───────────────────────────────
// Replaces Gemini — uses Claude Haiku via Vercel AI SDK for fast, cheap text.
// Exports retain the original "gemini*" names so callers need zero changes.

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const CLAUDE_GUIDE_MODEL = 'claude-haiku-4-5';

/**
 * Core text generation — drop-in replacement for geminiGenerate.
 * `model` param accepted but ignored (always uses Claude Haiku).
 */
export async function geminiGenerate(
  prompt: string,
  systemInstruction?: string,
  _model?: string,
  options?: { maxOutputTokens?: number; temperature?: number }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('PASTE')) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const { text } = await generateText({
    model:       anthropic(CLAUDE_GUIDE_MODEL),
    system:      systemInstruction,
    prompt,
    maxTokens:   options?.maxOutputTokens ?? 512,
    temperature: options?.temperature     ?? 0.4,
  });

  return text;
}

/**
 * Destination travel guide — best neighbourhoods, activities, food, tips.
 */
export async function geminiDestinationGuide(
  destination: string,
  travelDates?: string,
  interests?: string[]
): Promise<string> {
  const dateContext    = travelDates    ? ` for travel around ${travelDates}` : '';
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
 * Suggest alternative destinations based on user preferences.
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
