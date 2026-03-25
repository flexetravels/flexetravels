-- ─── FlexeTravels Database Schema ────────────────────────────────────────────
-- Run this in your Supabase SQL editor (project → SQL Editor → New query)
-- Uses UUID primary keys, RLS enabled, indexes on hot paths.

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── trips ────────────────────────────────────────────────────────────────────
create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  status      text not null default 'planning'
              check (status in ('planning','booked','cancelled','disrupted','archived')),
  origin      text not null,
  destination text not null,
  depart_date date not null,
  return_date date,
  adults      smallint not null default 1 check (adults >= 1 and adults <= 9),
  children    smallint not null default 0 check (children >= 0 and children <= 9),
  cabin_class text not null default 'economy',
  check_in    date,
  check_out   date,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trips_session_id_idx on trips(session_id);
create index if not exists trips_status_idx     on trips(status);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trips_updated_at
  before update on trips
  for each row execute function update_updated_at();

-- ─── bookings ─────────────────────────────────────────────────────────────────
create table if not exists bookings (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references trips(id) on delete cascade,
  type               text not null check (type in ('flight','hotel')),
  provider           text not null check (provider in ('duffel','liteapi')),
  status             text not null default 'pending'
                     check (status in ('pending','confirmed','cancelled','failed','disrupted')),
  provider_ref       text not null,          -- Duffel order_id / LiteAPI booking_id
  booking_ref        text,                   -- PNR / human-readable reference
  amount_cents       integer not null,
  currency           text not null default 'USD',
  flexibility_score  numeric(3,2),           -- 0.00 – 1.00
  flexibility_label  text check (flexibility_label in ('Flexible','Moderate','Locked')),
  offer_id           text,                   -- original offer ID used to book
  raw_conditions     jsonb,                  -- Duffel conditions object verbatim
  passenger_ids      text[] not null default '{}',
  metadata           jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists bookings_trip_id_idx     on bookings(trip_id);
create index if not exists bookings_provider_ref_idx on bookings(provider_ref);
create index if not exists bookings_status_idx       on bookings(status);

create trigger bookings_updated_at
  before update on bookings
  for each row execute function update_updated_at();

-- ─── events ───────────────────────────────────────────────────────────────────
-- Stores all inbound webhook events + system events for audit + replay
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid references bookings(id) on delete set null,
  trip_id     uuid references trips(id)    on delete set null,
  source      text not null
              check (source in ('duffel_webhook','liteapi_webhook','system','user')),
  type        text not null,               -- e.g. 'order.flight_disrupted'
  payload     jsonb not null default '{}',
  processed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists events_booking_id_idx on events(booking_id);
create index if not exists events_type_idx       on events(type);
create index if not exists events_processed_idx  on events(processed) where not processed;
create index if not exists events_created_at_idx on events(created_at desc);

-- ─── credits ──────────────────────────────────────────────────────────────────
-- Tracks refund credits owed to customers (for partial refunds, vouchers, etc.)
create table if not exists credits (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null,
  booking_id   uuid references bookings(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  currency     text not null default 'USD',
  reason       text not null,
  status       text not null default 'available'
               check (status in ('available','redeemed','expired')),
  expires_at   timestamptz,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists credits_session_id_idx on credits(session_id);
create index if not exists credits_status_idx     on credits(status) where status = 'available';

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Service role key bypasses RLS — used by our API.
-- Anon key (public) must not read any of these tables directly.

alter table trips    enable row level security;
alter table bookings enable row level security;
alter table events   enable row level security;
alter table credits  enable row level security;

-- Only service role can access (deny all for authenticated/anon)
create policy trips_service_only    on trips    for all using (false);
create policy bookings_service_only on bookings for all using (false);
create policy events_service_only   on events   for all using (false);
create policy credits_service_only  on credits  for all using (false);

-- ─── Setup instructions ───────────────────────────────────────────────────────
-- 1. Go to supabase.com → New project
-- 2. SQL Editor → Paste this file → Run
-- 3. Settings → API → copy Project URL + service_role key
-- 4. Add to Railway / .env.local:
--    SUPABASE_URL=https://xxxx.supabase.co
--    SUPABASE_SERVICE_KEY=eyJ...
--    SUPABASE_ANON_KEY=eyJ...   (optional, same as service key for now)
