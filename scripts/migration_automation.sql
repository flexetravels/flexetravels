-- ─────────────────────────────────────────────────────────────────────────────
-- FlexeTravels — Automation Layer DB Migration
-- Run this in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/pdohnltcgsgdwvxvtgoa/sql/new
-- ─────────────────────────────────────────────────────────────────────────────

-- ── automation_scripts ────────────────────────────────────────────────────────
-- Stores versioned Playwright scripts for each airline + action combination.
-- Updated automatically by the self-healer; read by the automation engine.

CREATE TABLE IF NOT EXISTS automation_scripts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  airline        TEXT        NOT NULL,
  action_type    TEXT        NOT NULL,   -- 'cancel' | 'change_date' | 'upgrade'
  version        INTEGER     NOT NULL DEFAULT 1,
  steps          JSONB       NOT NULL DEFAULT '[]',
  selectors      JSONB       NOT NULL DEFAULT '{}',
  confidence     FLOAT       NOT NULL DEFAULT 0.5,
  last_verified  TIMESTAMPTZ,
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one active script per airline/action (latest version wins)
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_scripts_airline_action
  ON automation_scripts (airline, action_type)
  WHERE active = true;

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_automation_scripts_lookup
  ON automation_scripts (airline, action_type, active);

-- ── execution_logs ─────────────────────────────────────────────────────────────
-- Records every Playwright execution — success or failure.
-- Used for confidence scoring and debugging.

CREATE TABLE IF NOT EXISTS execution_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id       UUID        REFERENCES automation_scripts(id) ON DELETE SET NULL,
  booking_id      UUID        REFERENCES bookings(id) ON DELETE SET NULL,
  airline         TEXT        NOT NULL,
  action_type     TEXT        NOT NULL,
  success         BOOLEAN     NOT NULL,
  duration_ms     INTEGER,
  error           TEXT,
  steps_completed INTEGER,
  total_steps     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_script
  ON execution_logs (script_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_logs_booking
  ON execution_logs (booking_id);

-- ── RLS Policies ──────────────────────────────────────────────────────────────
-- Service role key (used by Railway) bypasses RLS — no extra policy needed.
-- These tables are internal-only; no anon access required.

ALTER TABLE automation_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs     ENABLE ROW LEVEL SECURITY;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('automation_scripts', 'execution_logs');
