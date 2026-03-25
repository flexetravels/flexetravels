// ─── Failure Logger ───────────────────────────────────────────────────────────
// Captures detailed failure context (DOM, screenshot) before self-healing runs.
// This gives a debugging trail and feeds the healer with context.

import { db, DB_AVAILABLE } from '@/lib/db/client';

interface FailureEntry {
  scriptId?:        string;
  airline:          string;
  actionType:       string;
  error:            string;
  domSnapshot?:     string;
  screenshotBase64?: string;
}

export async function logFailure(entry: FailureEntry): Promise<void> {
  // Always log to console so Railway logs capture it
  console.error(
    `[automation/failures] ${entry.airline}/${entry.actionType} failed:`,
    entry.error,
  );

  if (!DB_AVAILABLE) return;

  try {
    // Store a slim version — no screenshot in DB (too large, use S3/storage if needed)
    await db.executionLogs.create({
      script_id:       entry.scriptId ?? null,
      booking_id:      null,
      airline:         entry.airline,
      action_type:     entry.actionType,
      success:         false,
      duration_ms:     null,
      error:           entry.error.slice(0, 2000),  // cap length
      steps_completed: null,
      total_steps:     null,
    });
  } catch (e) {
    console.error('[automation/failures] Failed to log failure to DB:', e);
  }
}
