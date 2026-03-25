// ─── Automation Job Queue ─────────────────────────────────────────────────────
// In-memory queue that processes automation jobs asynchronously — never blocks
// the HTTP request cycle.
//
// Architecture: Single Railway instance → in-memory queue is sufficient.
// Future upgrade path: swap for BullMQ + Redis when scaling horizontally.
//
// PERFORMANCE RULE: Playwright NEVER runs in the API request cycle.
//                   Always enqueue → process in background worker.

import type { AutomationJob, AutomationJobType } from '../automation/types';

// ─── Queue state ──────────────────────────────────────────────────────────────

const _queue: AutomationJob[]   = [];
let   _processing = false;
let   _jobCounter = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

export function enqueue(job: Omit<AutomationJob, 'id' | 'createdAt' | 'attempts'>): string {
  const id = `job_${++_jobCounter}_${Date.now()}`;
  const entry: AutomationJob = { ...job, id, createdAt: new Date().toISOString(), attempts: 0 };

  _queue.push(entry);
  console.log(`[queue] Enqueued ${job.type} → job ${id} (queue depth: ${_queue.length})`);

  // Kick off worker if not already running
  if (!_processing) {
    processNext();
  }

  return id;
}

export function queueDepth(): number {
  return _queue.length;
}

export function isProcessing(): boolean {
  return _processing;
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processNext(): Promise<void> {
  if (_queue.length === 0) {
    _processing = false;
    return;
  }

  _processing = true;
  const job   = _queue.shift()!;
  job.attempts++;

  console.log(`[queue] Processing ${job.type} (attempt ${job.attempts}) → ${job.id}`);

  try {
    await dispatch(job);
    console.log(`[queue] Completed ${job.type} → ${job.id}`);
  } catch (e) {
    console.error(`[queue] Failed ${job.type} → ${job.id}:`, e);

    // Retry up to 2 times total
    if (job.attempts < 2) {
      _queue.push(job);
      console.log(`[queue] Re-queued ${job.id} for retry (attempt ${job.attempts + 1})`);
    }
  }

  // Process next job
  setImmediate(processNext);
}

// ─── Job dispatcher ───────────────────────────────────────────────────────────

async function dispatch(job: AutomationJob): Promise<void> {
  switch (job.type) {
    case 'cancel_booking':
      await handleCancelBooking(job);
      break;

    case 'change_date':
      await handleChangeDate(job);
      break;

    case 'shadow_test':
      await handleShadowTest(job);
      break;

    default:
      throw new Error(`Unknown job type: ${(job as AutomationJob).type}`);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleCancelBooking(job: AutomationJob): Promise<void> {
  const { decideAndRun } = await import('../automation/engine');
  const result = await decideAndRun({
    airline:     job.airline ?? '',
    actionType:  'cancel',
    params:      {
      bookingRef: (job.params?.bookingRef as string) ?? job.providerRef ?? '',
      lastName:   (job.params?.lastName as string) ?? '',
    },
    bookingId:   job.bookingId,
    apiSupported: false,   // API already tried before enqueuing
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Automation failed');
  }
}

async function handleChangeDate(job: AutomationJob): Promise<void> {
  const { decideAndRun } = await import('../automation/engine');
  const result = await decideAndRun({
    airline:     job.airline ?? '',
    actionType:  'change_date',
    params:      job.params ?? {},
    bookingId:   job.bookingId,
    apiSupported: false,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Change date automation failed');
  }
}

async function handleShadowTest(job: AutomationJob): Promise<void> {
  // Shadow tests run scripts without real passenger data — just validate selectors exist
  const { db, DB_AVAILABLE } = await import('../db/client');
  if (!DB_AVAILABLE) return;

  const airline    = job.params?.airline as string;
  const actionType = job.params?.actionType as string;
  if (!airline || !actionType) return;

  const script = await db.automationScripts.get(airline, actionType);
  if (!script) return;

  // Verify selectors exist without completing the flow
  console.log(`[queue/shadow] Testing ${airline}/${actionType} selectors...`);
  // TODO: implement lightweight selector validation without full flow execution
}
