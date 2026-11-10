-- Garage Crates update: crates, your own named groupings of records ("Japanese", "Late-night", …).
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
alter table public.albums add column if not exists crates text[] not null default '{}';
create index if not exists albums_crates_idx on public.albums using gin (crates);
