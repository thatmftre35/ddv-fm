-- ════════════════════════════════════════════════════════════════
--  BAI / ddv-fm — Supabase schema
--  Run this once in the Supabase dashboard → SQL Editor → New query.
--  Contains NO secrets; safe to keep in the repo.
--
--  Access model: OPEN (no login). The publishable (anon) key in the
--  app can read/write all rows. Anyone with the app URL + that key can
--  too — fine for an internal tool. Tighten with auth later if needed.
-- ════════════════════════════════════════════════════════════════

-- Fleet: one row per equipment unit, keyed by its "EQ-NNN" id.
create table if not exists public.fleet (
  id         text primary key,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- Maintenance / event log (append-only). ts = epoch millis from client.
create table if not exists public.logs (
  id      bigint generated always as identity primary key,
  ts      bigint not null,
  payload jsonb  not null
);
create index if not exists logs_ts_idx on public.logs (ts desc);

-- Daily operator reports (append-only), grouped by equipment id.
create table if not exists public.daily_reports (
  id      bigint generated always as identity primary key,
  eq_id   text   not null,
  ts      bigint not null,
  payload jsonb  not null
);
create index if not exists daily_eq_ts_idx on public.daily_reports (eq_id, ts desc);

-- ── Row-Level Security: open access for the anon (publishable) key ──
alter table public.fleet         enable row level security;
alter table public.logs          enable row level security;
alter table public.daily_reports enable row level security;

drop policy if exists open_fleet on public.fleet;
drop policy if exists open_logs  on public.logs;
drop policy if exists open_daily on public.daily_reports;

create policy open_fleet on public.fleet
  for all to anon, authenticated using (true) with check (true);
create policy open_logs on public.logs
  for all to anon, authenticated using (true) with check (true);
create policy open_daily on public.daily_reports
  for all to anon, authenticated using (true) with check (true);
