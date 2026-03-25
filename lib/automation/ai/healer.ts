// ─── Self-Healing System ──────────────────────────────────────────────────────
// When a Playwright script fails, this module:
//   1. Takes the failed step index, DOM snapshot, and screenshot
//   2. Asks Claude to identify why the selector failed + suggest a fix
//   3. Returns an updated AutomationScript with new selectors + incremented version
//   4. Saves the healed script to DB for future use
//
// Trigger: runner.ts calls this after 2 consecutive failures (via retry.ts)

import type { AutomationScript, AutomationStep, ExecutionResult } from '../types';
import { db, DB_AVAILABLE } from '@/lib/db/client';

interface HealInput {
  failedResult: ExecutionResult;
}

// ─── Healing prompt ───────────────────────────────────────────────────────────

function buildHealPrompt(
  script:     AutomationScript,
  result:     ExecutionResult,
  dom:        string,
): string {
  const failedStep = script.steps[result.stepsCompleted] as AutomationStep | undefined;

  return `You are an expert at fixing broken Playwright selectors for airline websites.

Airline: ${script.airline}
Action:  ${script.actionType}
Failed at step index: ${result.stepsCompleted} of ${result.totalSteps}
Error: ${result.error}

Failed step:
${JSON.stringify(failedStep, null, 2)}

Current DOM (8000 char limit):
${dom.slice(0, 8000)}

The selector "${(failedStep as { selector?: string })?.selector ?? 'N/A'}" failed to find an element.

Analyse the DOM and provide a FIXED version of the step with a working selector.

Return ONLY valid JSON in this exact format:
{
  "fixedStep": { ...same step type with updated selector },
  "explanation": "brief explanation of what changed",
  "confidence": 0.8
}`;
}

// ─── Main healer ──────────────────────────────────────────────────────────────

export async function healScript(
  script: AutomationScript,
  result: ExecutionResult,
): Promise<AutomationScript | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[automation/healer] ANTHROPIC_API_KEY not configured');
    return null;
  }

  if (!result.domSnapshot) {
    console.warn('[automation/healer] No DOM snapshot available — cannot heal');
    return null;
  }

  const prompt = buildHealPrompt(script, result, result.domSnapshot);

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
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error('[automation/healer] Anthropic API error:', res.status);
      return null;
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const raw = data.content?.[0]?.text ?? '';

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[automation/healer] No JSON in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      fixedStep:   AutomationStep;
      explanation: string;
      confidence:  number;
    };

    // Build healed script — replace the failed step
    const healedSteps = [...script.steps];
    healedSteps[result.stepsCompleted] = parsed.fixedStep;

    const healedScript: AutomationScript = {
      ...script,
      steps:      healedSteps,
      version:    script.version + 1,
      confidence: Math.min(Math.max(parsed.confidence ?? script.confidence * 0.9, 0), 1),
      lastVerified: new Date().toISOString(),
    };

    console.log(
      `[automation/healer] Healed ${script.airline}/${script.actionType} ` +
      `step ${result.stepsCompleted}: ${parsed.explanation}`
    );

    // Persist the healed script if DB is available
    if (DB_AVAILABLE && script.id) {
      try {
        await db.automationScripts.upsert({
          id:           healedScript.id,
          airline:      healedScript.airline,
          action_type:  healedScript.actionType,
          version:      healedScript.version,
          steps:        healedScript.steps as Record<string, unknown>[],
          selectors:    healedScript.selectors,
          confidence:   healedScript.confidence,
          last_verified: healedScript.lastVerified ?? null,
          active:       healedScript.active,
        });
      } catch (e) {
        console.error('[automation/healer] Failed to persist healed script:', e);
      }
    }

    return healedScript;

  } catch (e) {
    console.error('[automation/healer] Healing failed:', e);
    return null;
  }
}
