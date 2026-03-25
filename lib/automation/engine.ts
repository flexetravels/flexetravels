// ─── Automation Decision Engine ───────────────────────────────────────────────
// The brain that chooses the right strategy for a post-booking action:
//
//   1. API (Duffel / LiteAPI) — fastest, most reliable
//   2. Known Playwright script — structured, versioned, self-healing
//   3. AI-generated Playwright script — for unsupported airlines
//   4. Guided user flow — last resort, zero automation
//
// SAFETY: AI-generated scripts CANNOT execute payments or finalise bookings.

import type { AutomationDecision, AutomationScript, AutomationStep } from './types';
import type { AutomationScriptRow } from '@/lib/db/client';
import { runWithRetry }   from './core/retry';
import { generateScript, getManageUrl } from './ai/generator';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { airCanadaScripts } from './airlines/aircanada';
import { westJetScripts }   from './airlines/westjet';

// ─── Row mapper ───────────────────────────────────────────────────────────────
function rowToScript(row: AutomationScriptRow): AutomationScript {
  return {
    id:           row.id,
    airline:      row.airline,
    actionType:   row.action_type,
    version:      row.version,
    steps:        row.steps as AutomationStep[],
    selectors:    row.selectors as Record<string, string>,
    confidence:   row.confidence,
    lastVerified: row.last_verified ?? undefined,
    active:       row.active,
  };
}

// ─── Built-in script registry ─────────────────────────────────────────────────

const BUILT_IN_SCRIPTS: Record<string, Record<string, AutomationScript>> = {
  air_canada: airCanadaScripts,
  westjet:    westJetScripts,
};

// ─── Input / output ───────────────────────────────────────────────────────────

interface EngineInput {
  airline:      string;
  actionType:   string;
  params:       Record<string, unknown>;  // bookingRef, lastName, newDate, etc.
  bookingId?:   string;
  apiSupported: boolean;               // caller indicates if API path was tried
}

interface EngineResult {
  success:    boolean;
  strategy:   AutomationDecision['strategy'];
  error?:     string;
  instructions?: string[];            // populated when strategy = 'guided'
}

// ─── Selector injection ───────────────────────────────────────────────────────
// Replace {{placeholder}} tokens in step values with real param values.

function injectParams(
  script: AutomationScript,
  params: Record<string, unknown>,
): AutomationScript {
  const stepsJson = JSON.stringify(script.steps);
  const injected  = stepsJson.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => String(params[key] ?? ''),
  );
  return { ...script, steps: JSON.parse(injected) };
}

// ─── Main decision engine ─────────────────────────────────────────────────────

export async function decideAndRun(input: EngineInput): Promise<EngineResult> {
  const normalised = input.airline.toLowerCase().replace(/[\s-]+/g, '_');

  // ── Strategy 1: Use API (caller must handle this before calling us) ──────────
  if (input.apiSupported) {
    return {
      success:  true,
      strategy: 'api',
    };
  }

  // ── Strategy 2: Known built-in script ────────────────────────────────────────
  const builtIn = BUILT_IN_SCRIPTS[normalised]?.[input.actionType];
  if (builtIn && builtIn.confidence >= 0.6) {
    const script  = injectParams(builtIn, input.params);
    const result  = await runWithRetry(script, input.bookingId);
    if (result.success) {
      return { success: true, strategy: 'playwright' };
    }
    // Fall through to DB-stored or AI-generated
    console.warn('[engine] Built-in script failed, trying DB/AI path');
  }

  // ── Strategy 3: DB-stored script (possibly healed/updated version) ───────────
  if (DB_AVAILABLE) {
    const dbRow = await db.automationScripts.get(normalised, input.actionType);
    if (dbRow && dbRow.confidence >= 0.5 && dbRow.active) {
      const script = injectParams(rowToScript(dbRow), input.params);
      const result = await runWithRetry(script, input.bookingId);
      if (result.success) {
        return { success: true, strategy: 'playwright' };
      }
    }
  }

  // ── Strategy 4: AI-generated script ─────────────────────────────────────────
  const manageUrl = getManageUrl(normalised);
  if (manageUrl) {
    console.log(`[engine] Generating script for ${normalised}/${input.actionType}`);
    const generated = await generateScript({
      airline:    normalised,
      actionType: input.actionType,
      manageUrl,
    });

    if (generated) {
      // Save to DB for future use
      if (DB_AVAILABLE) {
        try {
          await db.automationScripts.upsert({
            airline:     generated.script.airline,
            action_type: generated.script.actionType,
            version:     generated.script.version,
            steps:       generated.script.steps as Record<string, unknown>[],
            selectors:   generated.script.selectors,
            confidence:  generated.script.confidence,
            active:      generated.script.active,
          });
        } catch (e) {
          console.error('[engine] Failed to save generated script:', e);
        }
      }

      const script = injectParams(generated.script, input.params);
      const result = await runWithRetry(script, input.bookingId);
      if (result.success) {
        return { success: true, strategy: 'ai_generated' };
      }
    }
  }

  // ── Strategy 5: Guided user flow ─────────────────────────────────────────────
  return {
    success:   false,
    strategy:  'guided',
    error:     'Automated cancellation unavailable for this airline',
    instructions: guidedInstructions(input.airline, input.actionType, input.params),
  };
}

// ─── Guided fallback instructions ────────────────────────────────────────────

function guidedInstructions(
  airline:    string,
  actionType: string,
  params:     Record<string, unknown>,
): string[] {
  const ref = String(params.bookingRef ?? '');

  if (actionType === 'cancel') {
    return [
      `Visit ${airline.replace(/_/g, ' ')} website and go to "Manage Booking" or "My Trips".`,
      ref ? `Enter your booking reference: ${ref}` : 'Enter your booking reference and last name.',
      'Select the flight you wish to cancel and follow the cancellation steps.',
      'Keep your cancellation confirmation email.',
      'Forward it to support@flexetravels.com and we may issue a credit.',
    ];
  }

  if (actionType === 'change_date') {
    return [
      `Visit ${airline.replace(/_/g, ' ')} website and go to "Manage Booking".`,
      ref ? `Enter booking reference: ${ref}` : 'Enter your booking reference.',
      'Select "Change Flight" and choose your new date.',
      'Any fare difference will be charged by the airline directly.',
    ];
  }

  return [
    `Contact ${airline.replace(/_/g, ' ')} customer service directly.`,
    ref ? `Booking reference: ${ref}` : 'Have your booking reference ready.',
  ];
}
