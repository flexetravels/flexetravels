-- ─── FlexeTravels AI + Product Analytics Migration ─────────────────────────
-- Run after schema.sql, schema-canvas.sql, and schema-payments.sql.
-- Purpose: explain AI/canvas behaviour, learn customer preferences, debug
-- provider/search failures, and measure funnel performance without exposing
-- these tables to public clients.

create extension if not exists "pgcrypto";

-- Add richer search context to the existing search_logs table. These columns
-- are nullable so existing rows and older app versions continue to work.
alter table search_logs
  add column if not exists trip_canvas_id uuid,
  add column if not exists leg_id text,
  add column if not exists cabin_class text,
  add column if not exists child_ages smallint[] default '{}',
  add column if not exists flexible_dates date[] default '{}',
  add column if not exists filters jsonb not null default '{}',
  add column if not exists request_payload jsonb not null default '{}',
  add column if not exists provider_errors text[] default '{}',
  add column if not exists safe_error_category text,
  add column if not exists search_intent text,
  add column if not exists selected_result_id text;

create index if not exists search_logs_trip_canvas_idx
  on search_logs(trip_canvas_id, created_at desc)
  where trip_canvas_id is not null;

create index if not exists search_logs_leg_idx
  on search_logs(leg_id, created_at desc)
  where leg_id is not null;

create index if not exists search_logs_filters_gin_idx
  on search_logs using gin(filters);

-- One row per AI turn, including deterministic/direct-handler turns. This is
-- the table to inspect when a user says "the chat and canvas are not talking".
create table if not exists ai_interactions (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text not null,
  trip_canvas_id      uuid,
  surface             text not null check (surface in ('chat','canvas_command','command_bar','system')),
  model               text,
  user_message        text,
  sanitized           boolean not null default false,
  history_turns       smallint not null default 0,
  state_before        jsonb not null default '{}',
  state_after         jsonb not null default '{}',
  ops                 jsonb not null default '[]',
  response_text       text,
  tool_summary        jsonb not null default '{}',
  clarification       boolean not null default false,
  error               text,
  latency_ms          integer,
  created_at          timestamptz not null default now()
);

create index if not exists ai_interactions_session_idx
  on ai_interactions(session_id, created_at desc);
create index if not exists ai_interactions_trip_canvas_idx
  on ai_interactions(trip_canvas_id, created_at desc)
  where trip_canvas_id is not null;
create index if not exists ai_interactions_surface_idx
  on ai_interactions(surface, created_at desc);
create index if not exists ai_interactions_error_idx
  on ai_interactions(created_at desc)
  where error is not null;

-- Low-volume, structured canvas event trail. The canonical canvas still lives
-- in trips_canvas.state; this table explains the user actions that produced it.
create table if not exists trip_activity_events (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null,
  trip_canvas_id  uuid,
  event_type      text not null,
  leg_id          text,
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists trip_activity_events_session_idx
  on trip_activity_events(session_id, created_at desc);
create index if not exists trip_activity_events_trip_idx
  on trip_activity_events(trip_canvas_id, created_at desc)
  where trip_canvas_id is not null;
create index if not exists trip_activity_events_type_idx
  on trip_activity_events(event_type, created_at desc);

-- Normalized preference signals extracted from user actions. This gives us
-- useful "what customers want" analytics without querying raw canvas JSON for
-- every product question.
create table if not exists customer_preference_signals (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null,
  trip_canvas_id  uuid,
  signal_type     text not null,
  signal_value    text not null,
  confidence      numeric(3,2) not null default 1.00 check (confidence >= 0 and confidence <= 1),
  source          text not null check (source in ('vibe','canvas','chat','search','checkout','booking')),
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists customer_preference_signals_session_idx
  on customer_preference_signals(session_id, created_at desc);
create index if not exists customer_preference_signals_trip_idx
  on customer_preference_signals(trip_canvas_id, created_at desc)
  where trip_canvas_id is not null;
create index if not exists customer_preference_signals_type_value_idx
  on customer_preference_signals(signal_type, signal_value);

alter table ai_interactions             enable row level security;
alter table trip_activity_events        enable row level security;
alter table customer_preference_signals enable row level security;

drop policy if exists ai_interactions_service_only on ai_interactions;
create policy ai_interactions_service_only on ai_interactions
  for all to service_role using (true) with check (true);

drop policy if exists trip_activity_events_service_only on trip_activity_events;
create policy trip_activity_events_service_only on trip_activity_events
  for all to service_role using (true) with check (true);

drop policy if exists customer_preference_signals_service_only on customer_preference_signals;
create policy customer_preference_signals_service_only on customer_preference_signals
  for all to service_role using (true) with check (true);
