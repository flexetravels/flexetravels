// ─── AI-Assisted Script Generator ────────────────────────────────────────────
// When no script exists for an airline/action, this module:
//   1. Navigates to the airline's manage-booking page
//   2. Captures the DOM
//   3. Asks Claude to generate a structured AutomationScript
//   4. Returns the script for storage + immediate execution
//
// SAFETY RULE: AI-generated scripts CANNOT execute payments or finalise bookings.
//              They are limited to cancel / change / lookup flows.

import type { AutomationScript, AutomationStep } from '../types';

interface GeneratorInput {
  airline:      string;     // e.g. 'air_canada'
  actionType:   string;     // 'cancel' | 'change_date'
  manageUrl:    string;     // airline's manage-booking page
  domSnapshot?: string;     // optional — pre-captured for efficiency
}

interface GeneratorOutput {
  script:   AutomationScript;
  rawResponse: string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(input: GeneratorInput, dom: string): string {
  return `You are an expert at generating Playwright automation scripts for airline websites.

Airline: ${input.airline}
Action:  ${input.actionType}
URL:     ${input.manageUrl}

DOM (truncated to 8000 chars):
${dom.slice(0, 8000)}

Generate a JSON array of Playwright steps to perform the "${input.actionType}" action.
Each step MUST be one of:
  { "type": "navigate",   "url": "..." }
  { "type": "click",      "selector": "...", "description": "..." }
  { "type": "fill",       "selector": "...", "value": "{{placeholder}}", "description": "..." }
  { "type": "wait",       "selector": "..." }
  { "type": "assert",     "selector": "...", "description": "..." }
  { "type": "screenshot", "name": "..." }

Use {{bookingRef}} and {{lastName}} as placeholders for passenger data.

CRITICAL SAFETY RULES:
- DO NOT include steps that process payments or finalise new bookings
- DO NOT include steps that enter credit card data
- Only generate steps for: cancel, lookup, change-date, upgrade seat flows

Return ONLY a valid JSON object in this exact format:
{
  "steps": [...],
  "selectors": { "name": "selector" },
  "confidence": 0.7
}`;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateScript(
  input: GeneratorInput,
): Promise<GeneratorOutput | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[automation/generator] ANTHROPIC_API_KEY not configured');
    return null;
  }

  // Fetch DOM snapshot if not provided
  let dom = input.domSnapshot ?? '';
  if (!dom) {
    try {
      const res = await fetch(input.manageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 FlexeTravels-Automation/1.0' },
        signal:  AbortSignal.timeout(10_000),
      });
      dom = await res.text();
    } catch (e) {
      console.error('[automation/generator] Failed to fetch DOM:', e);
      return null;
    }
  }

  const prompt = buildPrompt(input, dom);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.error('[automation/generator] Anthropic API error:', res.status);
      return null;
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const rawResponse = data.content?.[0]?.text ?? '';

    // Parse JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[automation/generator] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      steps:      AutomationStep[];
      selectors:  Record<string, string>;
      confidence: number;
    };

    const script: AutomationScript = {
      airline:    input.airline,
      actionType: input.actionType,
      version:    1,
      steps:      parsed.steps,
      selectors:  parsed.selectors ?? {},
      confidence: Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1),
      active:     true,
    };

    console.log(
      `[automation/generator] Generated ${script.steps.length}-step script for ` +
      `${input.airline}/${input.actionType} (confidence: ${script.confidence})`
    );

    return { script, rawResponse };

  } catch (e) {
    console.error('[automation/generator] Generation failed:', e);
    return null;
  }
}

// ─── Airline manage-URL registry ─────────────────────────────────────────────

export const AIRLINE_MANAGE_URLS: Record<string, string> = {
  air_canada:   'https://www.aircanada.com/en/ca/aco/home.html#/manage-booking',
  westjet:      'https://www.westjet.com/en-ca/trips/manage',
  air_transat:  'https://www.airtransat.com/en-CA/travel-info/manage-my-booking',
  flair:        'https://flyflair.com/manage-booking',
  swoop:        'https://www.flyswoop.com/manage-booking',
  porter:       'https://www.flyporter.com/manage-booking',
};

export function getManageUrl(airline: string): string | null {
  return AIRLINE_MANAGE_URLS[airline.toLowerCase().replace(/\s+/g, '_')] ?? null;
}
