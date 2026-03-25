// ─── Execution Logger ─────────────────────────────────────────────────────────
// Writes execution results to the execution_logs table in Supabase.
// Also updates the script's confidence score based on rolling success rate.

import { db, DB_AVAILABLE } from '@/lib/db/client';
import type { ExecutionResult } from '../types';

interface ExecutionLogEntry extends ExecutionResult {
  bookingId?: string;
}

export async function logExecution(entry: ExecutionLogEntry): Promise<void> {
  if (!DB_AVAILABLE) return;

  try {
    await db.executionLogs.create({
      script_id:       entry.scriptId ?? null,
      booking_id:      entry.bookingId ?? null,
      airline:         entry.airline,
      action_type:     entry.actionType,
      success:         entry.success,
      duration_ms:     entry.durationMs,
      error:           entry.error ?? null,
      steps_completed: entry.stepsCompleted,
      total_steps:     entry.totalSteps,
    });

    // Update script confidence if script_id is known
    if (entry.scriptId) {
      await updateConfidence(entry.scriptId, entry.success);
    }
  } catch (e) {
    // Non-fatal — logging should never crash the automation flow
    console.error('[automation/executions] Failed to log execution:', e);
  }
}

// ─── Confidence update ────────────────────────────────────────────────────────
// confidence_score = success_rate_last_20 * recency_factor
// Simplified version: rolling weighted average

async function updateConfidence(scriptId: string, succeeded: boolean): Promise<void> {
  if (!DB_AVAILABLE) return;

  try {
    const logs = await db.executionLogs.getByScript(scriptId, 20);
    if (logs.length === 0) return;

    // Recency-weighted success rate — recent runs count more
    let weightedSuccesses = 0;
    let totalWeight       = 0;

    logs.forEach((log, idx) => {
      const weight = Math.pow(0.9, logs.length - 1 - idx); // newer = higher weight
      totalWeight       += weight;
      weightedSuccesses += log.success ? weight : 0;
    });

    const newConfidence = totalWeight > 0 ? weightedSuccesses / totalWeight : 0.5;

    await db.automationScripts.updateConfidence(scriptId, newConfidence);
  } catch (e) {
    console.error('[automation/executions] Failed to update confidence:', e);
  }
}
