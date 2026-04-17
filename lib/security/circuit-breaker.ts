// ─── Circuit Breaker ─────────────────────────────────────────────────────────
// In-memory circuit breaker for external API calls (Duffel, LiteAPI, Stripe,
// Anthropic, Gemini).  Prevents cascading failures when a provider is degraded.
//
// States:
//   closed    → normal operation; failures are counted
//   open      → all requests rejected; service is resting
//   half-open → one probe request allowed; success → closed, fail → open
//
// Usage:
//   import { circuitBreaker } from '@/lib/security/circuit-breaker';
//
//   if (!circuitBreaker.isAllowed('duffel')) {
//     throw new Error('Service temporarily unavailable');
//   }
//   try {
//     const result = await callDuffelApi();
//     circuitBreaker.recordSuccess('duffel');
//     return result;
//   } catch (err) {
//     circuitBreaker.recordFailure('duffel');
//     throw err;
//   }

import { SECURITY_CONFIG } from './config';

type CircuitState = 'closed' | 'open' | 'half-open';

interface ServiceRecord {
  state:       CircuitState;
  failures:    number;
  total:       number;
  windowStart: number;   // epoch ms — start of current rolling window
  openedAt:    number;   // epoch ms — when the circuit was last opened (0 if closed)
}

const services = new Map<string, ServiceRecord>();

function newRecord(): ServiceRecord {
  return { state: 'closed', failures: 0, total: 0, windowStart: Date.now(), openedAt: 0 };
}

function get(service: string): ServiceRecord {
  if (!services.has(service)) services.set(service, newRecord());
  return services.get(service)!;
}

/** Rolls the window if it has expired, resetting counters. */
function rollWindowIfExpired(rec: ServiceRecord): void {
  const now = Date.now();
  if (now - rec.windowStart >= SECURITY_CONFIG.circuitBreaker.windowMs) {
    rec.failures    = 0;
    rec.total       = 0;
    rec.windowStart = now;
  }
}

export const circuitBreaker = {
  /**
   * Returns true when the service should be called.
   * Returns false when the circuit is open (service is resting).
   *
   * When open and the cooldown has elapsed, transitions to half-open and
   * returns true so a single probe request can be sent.
   */
  isAllowed(service: string): boolean {
    const rec = get(service);
    const cfg = SECURITY_CONFIG.circuitBreaker;
    const now = Date.now();

    if (rec.state === 'open') {
      if (now - rec.openedAt >= cfg.cooldownMs) {
        rec.state = 'half-open';
        console.log(`[CircuitBreaker] ${service}: open → half-open`);
        return true;  // allow one probe
      }
      return false;  // still cooling down
    }

    return true;  // closed or half-open
  },

  /** Call this after the external API returns successfully. */
  recordSuccess(service: string): void {
    const rec = get(service);
    rollWindowIfExpired(rec);
    rec.total++;

    if (rec.state === 'half-open') {
      // Probe succeeded — close the circuit
      rec.state    = 'closed';
      rec.failures = 0;
      console.log(`[CircuitBreaker] ${service}: half-open → closed (probe succeeded)`);
    }
  },

  /** Call this after the external API throws or returns an error status. */
  recordFailure(service: string): void {
    const rec = get(service);
    const cfg = SECURITY_CONFIG.circuitBreaker;
    rollWindowIfExpired(rec);
    rec.failures++;
    rec.total++;

    if (rec.state === 'half-open') {
      // Probe failed — reopen the circuit immediately
      rec.state    = 'open';
      rec.openedAt = Date.now();
      console.warn(`[CircuitBreaker] ${service}: half-open → open (probe failed)`);
      return;
    }

    if (
      rec.state === 'closed' &&
      rec.total >= cfg.minRequests &&
      rec.failures / rec.total >= cfg.errorThreshold
    ) {
      rec.state    = 'open';
      rec.openedAt = Date.now();
      console.warn(
        `[CircuitBreaker] ${service}: closed → open ` +
        `(${rec.failures}/${rec.total} failures in window)`,
      );
    }
  },

  /** Current state of a service (for health endpoints / observability). */
  getState(service: string): CircuitState {
    return get(service).state;
  },

  /** Snapshot of all tracked services. */
  snapshot(): Record<string, { state: CircuitState; failures: number; total: number }> {
    const out: Record<string, { state: CircuitState; failures: number; total: number }> = {};
    for (const [name, rec] of services) {
      out[name] = { state: rec.state, failures: rec.failures, total: rec.total };
    }
    return out;
  },
};
