-- ─── FlexeTravels Payment Ledger Migration ──────────────────────────────────
-- Run this after the base schema in Supabase SQL editor.
-- Purpose: quote immutability, idempotent booking, supplier reconciliation,
-- partial-failure recovery, and audit-grade money movement.

create extension if not exists "pgcrypto";

-- Immutable checkout quote shown to the customer before Stripe/Razorpay.
create table if not exists payment_quotes (
  id                 uuid primary key default gen_random_uuid(),
  session_id          text not null,
  trip_canvas_id      uuid,
  market              text not null check (market in ('CA','US','IN','OTHER')),
  strategy            text not null check (
                       strategy in (
                         'duffel_payments_markup',
                         'stripe_balance',
                         'razorpay_balance',
                         'supplier_direct'
                       )
                     ),
  merchant_of_record  text not null default 'FlexeTravels and Tours Inc.',
  supplier            text not null,
  fare_amount_cents   integer not null default 0 check (fare_amount_cents >= 0),
  fare_currency       text not null,
  fee_amount_cents    integer not null check (fee_amount_cents >= 0),
  fee_currency        text not null,
  charge_amount_cents integer not null check (charge_amount_cents >= 0),
  charge_currency     text not null,
  offer_ids           text[] not null default '{}',
  cart_hash           text not null,
  caveats             text[] not null default '{}',
  expires_at          timestamptz not null,
  status              text not null default 'open'
                       check (status in ('open','consumed','expired','cancelled')),
  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  consumed_at         timestamptz
);

create index if not exists payment_quotes_session_idx on payment_quotes(session_id, created_at desc);
create index if not exists payment_quotes_status_idx on payment_quotes(status, expires_at);
create unique index if not exists payment_quotes_cart_hash_open_idx
  on payment_quotes(session_id, cart_hash)
  where status = 'open';

-- One external payment authorization/capture per quote.
create table if not exists payment_transactions (
  id                    uuid primary key default gen_random_uuid(),
  quote_id               uuid not null references payment_quotes(id) on delete restrict,
  provider               text not null check (provider in ('stripe','razorpay','duffel')),
  provider_payment_id    text not null,
  idempotency_key        text not null,
  status                 text not null default 'created'
                         check (
                           status in (
                             'created','requires_action','succeeded',
                             'failed','refunding','refunded','partially_refunded'
                           )
                         ),
  amount_cents           integer not null check (amount_cents >= 0),
  currency               text not null,
  expected_amount_cents  integer not null check (expected_amount_cents >= 0),
  expected_currency      text not null,
  failure_reason         text,
  raw_payload            jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists payment_transactions_provider_payment_uidx
  on payment_transactions(provider, provider_payment_id);
create unique index if not exists payment_transactions_idempotency_uidx
  on payment_transactions(idempotency_key);
create index if not exists payment_transactions_quote_idx on payment_transactions(quote_id);
create index if not exists payment_transactions_status_idx on payment_transactions(status);

-- Every supplier booking attempt caused by a paid quote.
create table if not exists supplier_bookings (
  id                    uuid primary key default gen_random_uuid(),
  quote_id               uuid not null references payment_quotes(id) on delete restrict,
  payment_transaction_id uuid references payment_transactions(id) on delete restrict,
  leg_index              integer not null default 0 check (leg_index >= 0),
  supplier               text not null check (supplier in ('duffel','liteapi','amadeus','travelport','manual')),
  product_type           text not null check (product_type in ('flight','hotel','activity','insurance')),
  supplier_offer_id      text,
  supplier_booking_id    text,
  supplier_reference     text,
  status                 text not null default 'pending'
                         check (
                           status in (
                             'pending','confirmed','failed','cancelled',
                             'requires_action','refund_due','refunded'
                           )
                         ),
  amount_cents           integer not null default 0 check (amount_cents >= 0),
  currency               text not null,
  failure_reason         text,
  raw_request            jsonb not null default '{}',
  raw_response           jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists supplier_bookings_quote_idx on supplier_bookings(quote_id, leg_index);
create index if not exists supplier_bookings_status_idx on supplier_bookings(status);
create unique index if not exists supplier_bookings_supplier_ref_uidx
  on supplier_bookings(supplier, supplier_booking_id)
  where supplier_booking_id is not null;

-- Double-entry-style money movement ledger for reconciliation.
create table if not exists ledger_entries (
  id                    uuid primary key default gen_random_uuid(),
  quote_id               uuid references payment_quotes(id) on delete restrict,
  payment_transaction_id uuid references payment_transactions(id) on delete restrict,
  supplier_booking_id    uuid references supplier_bookings(id) on delete restrict,
  account                text not null check (
                           account in (
                             'customer_cash',
                             'stripe_cash',
                             'razorpay_cash',
                             'duffel_balance',
                             'supplier_payable',
                             'service_fee_revenue',
                             'refund_payable'
                           )
                         ),
  direction              text not null check (direction in ('debit','credit')),
  amount_cents           integer not null check (amount_cents > 0),
  currency               text not null,
  memo                   text,
  created_at             timestamptz not null default now()
);

create index if not exists ledger_entries_quote_idx on ledger_entries(quote_id, created_at);
create index if not exists ledger_entries_tx_idx on ledger_entries(payment_transaction_id);
create index if not exists ledger_entries_account_idx on ledger_entries(account, created_at desc);

-- Shared updated_at trigger from schema.sql, duplicated defensively for
-- standalone migration execution.
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists payment_transactions_updated_at on payment_transactions;
create trigger payment_transactions_updated_at
  before update on payment_transactions
  for each row execute function update_updated_at();

drop trigger if exists supplier_bookings_updated_at on supplier_bookings;
create trigger supplier_bookings_updated_at
  before update on supplier_bookings
  for each row execute function update_updated_at();

alter table payment_quotes        enable row level security;
alter table payment_transactions  enable row level security;
alter table supplier_bookings     enable row level security;
alter table ledger_entries        enable row level security;

drop policy if exists payment_quotes_service_only on payment_quotes;
create policy payment_quotes_service_only on payment_quotes
  for all to service_role using (true) with check (true);

drop policy if exists payment_transactions_service_only on payment_transactions;
create policy payment_transactions_service_only on payment_transactions
  for all to service_role using (true) with check (true);

drop policy if exists supplier_bookings_service_only on supplier_bookings;
create policy supplier_bookings_service_only on supplier_bookings
  for all to service_role using (true) with check (true);

drop policy if exists ledger_entries_service_only on ledger_entries;
create policy ledger_entries_service_only on ledger_entries
  for all to service_role using (true) with check (true);
