-- Adds the wash queue: records you've marked "To wash", and when each was last washed.
-- Run once in the Supabase SQL Editor. Safe to run again.

alter table public.albums add column if not exists to_wash_since timestamptz;
alter table public.albums add column if not exists washed_at timestamptz;
