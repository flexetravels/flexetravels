// ─── Automation Layer — Shared Types ─────────────────────────────────────────
// Used across core, airlines, ai, and logs sub-modules.

// ─── Step types ───────────────────────────────────────────────────────────────

export type AutomationStep =
  | { type: 'navigate';   url: string }
  | { type: 'click';      selector: string; description?: string }
  | { type: 'fill';       selector: string; value: string; description?: string }
  | { type: 'select';     selector: string; value: string }
  | { type: 'wait';       ms?: number; selector?: string; description?: string }
  | { type: 'waitNav' }
  | { type: 'screenshot'; name?: string }
  | { type: 'assert';     selector: string; text?: string; description?: string };

// ─── Script stored in DB ──────────────────────────────────────────────────────

export interface AutomationScript {
  id?:            string;
  airline:        string;       // e.g. 'air_canada', 'westjet'
  actionType:     string;       // 'cancel' | 'change_date' | 'upgrade'
  version:        number;
  steps:          AutomationStep[];
  selectors:      Record<string, string>;  // named selectors for reuse
  confidence:     number;       // 0–1, success_rate * recency_factor
  lastVerified?:  string;       // ISO timestamp
  active:         boolean;
}

// ─── Execution result ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  success:         boolean;
  scriptId?:       string;
  airline:         string;
  actionType:      string;
  stepsCompleted:  number;
  totalSteps:      number;
  durationMs:      number;
  error?:          string;
  screenshotBase64?: string;    // captured on failure for AI analysis
  domSnapshot?:    string;      // captured on failure for healer
}

// ─── Queue job ────────────────────────────────────────────────────────────────

export type AutomationJobType = 'cancel_booking' | 'change_date' | 'shadow_test';

export interface AutomationJob {
  id:          string;
  type:        AutomationJobType;
  bookingId?:  string;
  sessionId?:  string;
  airline?:    string;
  providerRef?: string;
  params?:     Record<string, unknown>;
  createdAt:   string;
  attempts:    number;
}

// ─── Decision engine result ───────────────────────────────────────────────────

export type AutomationStrategy = 'api' | 'playwright' | 'ai_generated' | 'guided';

export interface AutomationDecision {
  strategy:  AutomationStrategy;
  script?:   AutomationScript;
  reason:    string;
}
