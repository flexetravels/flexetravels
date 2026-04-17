// ─── Concurrency Limiter ──────────────────────────────────────────────────────
// In-memory semaphore that caps simultaneous in-flight requests for expensive
// endpoints (chat, search, booking).  Excess requests queue; if the queue wait
// exceeds the timeout the slot is never acquired and null is returned.
//
// Usage:
//   import { concurrencyLimiter } from '@/lib/security/concurrency';
//
//   const release = await concurrencyLimiter.acquire('chat');
//   if (!release) {
//     return new Response('Server busy', { status: 429 });
//   }
//   try {
//     return await doExpensiveWork();
//   } finally {
//     release();
//   }

import { SECURITY_CONFIG } from './config';

interface Slot {
  active: number;
  queue:  Array<() => void>;
}

const slots = new Map<string, Slot>();

function getSlot(name: string): Slot {
  if (!slots.has(name)) slots.set(name, { active: 0, queue: [] });
  return slots.get(name)!;
}

export const concurrencyLimiter = {
  /**
   * Acquires a concurrency slot for `name`.
   *
   * Returns a release function when a slot is available (possibly after waiting
   * in the queue up to `timeoutMs`).
   * Returns null if the wait timed out — caller should return 429.
   */
  async acquire(
    name:      string,
    timeoutMs: number = SECURITY_CONFIG.concurrentQueueTimeoutMs,
  ): Promise<(() => void) | null> {
    const max  = SECURITY_CONFIG.maxConcurrent[name as keyof typeof SECURITY_CONFIG.maxConcurrent] ?? 10;
    const slot = getSlot(name);

    if (slot.active < max) {
      slot.active++;
      return () => this._release(name);
    }

    // Queue the request — resolve when a slot opens or timeout fires
    return new Promise<(() => void) | null>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = slot.queue.indexOf(proceed);
        if (idx !== -1) slot.queue.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const proceed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        slot.active++;
        resolve(() => this._release(name));
      };

      slot.queue.push(proceed);
    });
  },

  _release(name: string): void {
    const slot = getSlot(name);
    slot.active = Math.max(0, slot.active - 1);
    const next  = slot.queue.shift();
    if (next) next();
  },

  /** Returns current utilization for health endpoints / observability. */
  snapshot(): Record<string, { active: number; queued: number; max: number }> {
    const out: Record<string, { active: number; queued: number; max: number }> = {};
    for (const [name, slot] of slots) {
      const max = SECURITY_CONFIG.maxConcurrent[name as keyof typeof SECURITY_CONFIG.maxConcurrent] ?? 10;
      out[name] = { active: slot.active, queued: slot.queue.length, max };
    }
    return out;
  },
};
