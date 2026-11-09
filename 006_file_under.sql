-- Garage Crates update: "File under", for the odd artist who shouldn't be filed by surname (e.g. Sun Ra under S).
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
alter table public.albums add column if not exists sort_as text;
