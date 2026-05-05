-- ─── Trip Canvas — additive migration ────────────────────────────────────────
-- Run in Supabase SQL Editor → New query → paste → Run.
-- Safe to re-run (uses IF NOT EXISTS). Drops nothing in existing schema.
-- Rolls back cleanly with: drop table if exists trips_canvas;

create extension if not exists "pgcrypto";

-- Reuse the update_updated_at() trigger function defined in schema.sql.
-- If running this before schema.sql, define it here too.
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ─── trips_canvas ────────────────────────────────────────────────────────────
-- Holds the visual trip canvas state (legs, flights, hotels) as JSONB.
-- Independent of `trips` table — `trips` records confirmed bookings;
-- `trips_canvas` records in-progress planning artifacts. They join only when
-- the user proceeds to checkout.

create table if not exists trips_canvas (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null,
  user_id      uuid,                  -- supabase auth.users.id, optional
  title        text not null default 'Untitled trip',
  origin_city  text,
  state        jsonb not null default '{}'::jsonb,
  status       text not null default 'planning'
               check (status in ('planning','booked','archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists trips_canvas_session_id_idx on trips_canvas(session_id);
create index if not exists trips_canvas_user_id_idx    on trips_canvas(user_id) where user_id is not null;
create index if not exists trips_canvas_updated_at_idx on trips_canvas(updated_at desc);
create index if not exists trips_canvas_status_idx     on trips_canvas(status);

drop trigger if exists trips_canvas_updated_at on trips_canvas;
create trigger trips_canvas_updated_at
  before update on trips_canvas
  for each row execute function update_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Service role only — same model as the rest of the schema. The service_role
-- key lives only on the server (never sent to browsers), and the anon role
-- has no policies, so the table is fully locked down to direct REST access.

alter table trips_canvas enable row level security;

drop policy if exists "Service role full access" on trips_canvas;
create policy "Service role full access" on trips_canvas
  for all
  to service_role
  using (true)
  with check (true);
