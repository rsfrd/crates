-- Adds the year each album first came out (from its Discogs album family), so a 1972 reissue of a
-- 1959 album shows and files as 1959, with the pressing's own year kept beside its catalogue number.
-- Run once in the Supabase SQL Editor. Safe to run again.

alter table public.albums add column if not exists original_year int;
