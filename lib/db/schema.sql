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

drop trigger if exists trips_updated_at on trips;
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

drop trigger if exists bookings_updated_at on bookings;
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

-- ─── payments ────────────────────────────────────────────────────────────────
-- Persists Stripe payment confirmations (replaces in-memory Map).
create table if not exists payments (
  id                   uuid primary key default gen_random_uuid(),
  stripe_intent_id     text unique,              -- PaymentIntent ID
  stripe_session_id    text unique,              -- Checkout Session ID (nullable)
  booking_ref          text not null,            -- links to bookings.booking_ref
  amount_cents         integer not null,
  currency             text not null default 'USD',
  status               text not null default 'succeeded'
                       check (status in ('succeeded','failed','refunded')),
  paid_at              timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create index if not exists payments_booking_ref_idx    on payments(booking_ref);
create index if not exists payments_stripe_intent_idx  on payments(stripe_intent_id);

-- ─── search_logs ─────────────────────────────────────────────────────────────
-- Tracks every flight/hotel search for growth analytics & conversion funnels.
create table if not exists search_logs (
  id                   uuid primary key default gen_random_uuid(),
  session_id           text not null,
  search_type          text not null check (search_type in ('flight','hotel')),
  origin               text,                    -- IATA code (flights only)
  destination          text not null,
  depart_date          date,
  return_date          date,
  adults               smallint default 1,
  children             smallint default 0,
  result_count         integer not null default 0,
  provider_sources     text[] default '{}',
  latency_ms           integer,
  converted            boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists search_logs_session_idx     on search_logs(session_id);
create index if not exists search_logs_dest_idx        on search_logs(destination);
create index if not exists search_logs_created_idx     on search_logs(created_at desc);

-- ─── user_sessions ───────────────────────────────────────────────────────────
-- Anonymous user engagement tracking (DAU/MAU without full auth).
create table if not exists user_sessions (
  session_id           text primary key,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  user_agent_hash      text,                    -- SHA-256 of User-Agent (privacy)
  total_searches       integer not null default 0,
  total_bookings       integer not null default 0,
  metadata             jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists user_sessions_last_seen_idx on user_sessions(last_seen_at desc);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Service role key bypasses RLS — used by our API.
-- Anon key (public) must not read any of these tables directly.

alter table trips         enable row level security;
alter table bookings      enable row level security;
alter table events        enable row level security;
alter table credits       enable row level security;
alter table payments      enable row level security;
alter table search_logs   enable row level security;
alter table user_sessions enable row level security;

-- Only service role can access (deny all for authenticated/anon)
drop policy if exists trips_service_only         on trips;
drop policy if exists bookings_service_only      on bookings;
drop policy if exists events_service_only        on events;
drop policy if exists credits_service_only       on credits;
drop policy if exists payments_service_only      on payments;
drop policy if exists search_logs_service_only   on search_logs;
drop policy if exists user_sessions_service_only on user_sessions;

create policy trips_service_only         on trips         for all using (false);
create policy bookings_service_only      on bookings      for all using (false);
create policy events_service_only        on events        for all using (false);
create policy credits_service_only       on credits       for all using (false);
create policy payments_service_only      on payments      for all using (false);
create policy search_logs_service_only   on search_logs   for all using (false);
create policy user_sessions_service_only on user_sessions for all using (false);

-- ─── Setup instructions ───────────────────────────────────────────────────────
-- 1. Go to supabase.com → New project
-- 2. SQL Editor → Paste this file → Run
-- 3. Settings → API → copy Project URL + service_role key
-- 4. Add to Railway / .env.local:
--    SUPABASE_URL=https://xxxx.supabase.co
--    SUPABASE_SERVICE_KEY=eyJ...
--    SUPABASE_ANON_KEY=eyJ...   (optional, same as service key for now)
