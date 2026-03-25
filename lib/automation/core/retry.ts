// ─── Retry + Self-Healing Orchestrator ───────────────────────────────────────
// Execution flow:
//   1. Run script
//   2. On failure: retry once immediately
//   3. On second failure: trigger AI self-healer to update selectors
//   4. Run healed script
//   5. Persist execution log either way

import type { AutomationScript, ExecutionResult } from '../types';
import { runScript }           from './runner';
import { healScript }          from '../ai/healer';
import { logExecution }        from '../logs/executions';
import { logFailure }          from '../logs/failures';

export async function runWithRetry(
  script:    AutomationScript,
  bookingId?: string,
): Promise<ExecutionResult> {
  // Attempt 1
  let result = await runScript(
    script.steps,
    script.id,
    script.airline,
    script.actionType,
  );

  if (result.success) {
    await logExecution({ ...result, bookingId });
    return result;
  }

  console.warn(
    `[automation/retry] Attempt 1 failed for ${script.airline}/${script.actionType}:`,
    result.error,
  );

  // Attempt 2 — immediate retry (transient failures, loading delays)
  result = await runScript(
    script.steps,
    script.id,
    script.airline,
    script.actionType,
  );

  if (result.success) {
    await logExecution({ ...result, bookingId });
    return result;
  }

  console.warn(
    `[automation/retry] Attempt 2 failed — triggering self-healing for ${script.airline}/${script.actionType}`,
  );

  // Log the failure before healing so we have the raw error captured
  await logFailure({
    scriptId:   script.id,
    airline:    script.airline,
    actionType: script.actionType,
    error:      result.error ?? 'unknown',
    domSnapshot:      result.domSnapshot,
    screenshotBase64: result.screenshotBase64,
  });

  // Attempt 3 — after AI self-healing
  const healed = await healScript(script, result);
  if (!healed) {
    // Healing failed or not possible; return the failure
    return result;
  }

  const finalResult = await runScript(
    healed.steps,
    healed.id ?? script.id,
    healed.airline,
    healed.actionType,
  );

  await logExecution({ ...finalResult, bookingId });

  if (!finalResult.success) {
    await logFailure({
      scriptId:   healed.id ?? script.id,
      airline:    healed.airline,
      actionType: healed.actionType,
      error:      finalResult.error ?? 'unknown (post-heal)',
      domSnapshot:      finalResult.domSnapshot,
      screenshotBase64: finalResult.screenshotBase64,
    });
  }

  return finalResult;
}
