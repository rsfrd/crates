-- Garage Crates update: Discogs marketplace prices for want-list records.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- master_id: the Discogs "album family" a pressing belongs to, so the marketplace links can show every vinyl pressing.
-- price:     the last marketplace check, e.g. {"value": 24.5, "currency": "USD", "for_sale": 7, "checked_at": "…"}.
alter table public.albums add column if not exists master_id bigint;
alter table public.albums add column if not exists price jsonb;
