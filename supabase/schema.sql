-- Garage Crates: vinyl collection schema
-- Run this once in Supabase → SQL Editor → New query → Run.

create table if not exists public.albums (
  id              uuid primary key default gen_random_uuid(),
  artist          text not null,
  title           text not null,
  catno           text,
  genres          text[]  not null default '{}',

  -- 'owned' = in the collection, 'want' = on the want list
  status          text    not null default 'owned' check (status in ('owned', 'want')),
  for_sale        boolean not null default false,
  notes           text,

  -- Filled in from Discogs
  year            int,
  label           text,
  cover_url       text,
  thumb_url       text,
  cover_locked    boolean not null default false,  -- true when you picked the cover yourself
  discogs_id      bigint,
  discogs_url     text,
  tracks          jsonb   not null default '[]',   -- [{pos, title, dur}]
  credits         jsonb   not null default '[]',   -- [{name, id, roles[], kind, leader, tracks}]
  personnel_hint  text[]  not null default '{}',   -- names from the original spreadsheet

  -- pending | matched | review | not_found | error
  enrich_status   text    not null default 'pending',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists albums_touch on public.albums;
create trigger albums_touch before update on public.albums
  for each row execute function public.touch_updated_at();

-- Only signed-in users can see or change anything.
-- Turn OFF new sign-ups (Authentication → Sign In / Providers → "Allow new users to sign up")
-- after creating your own account, so you are the only signed-in user there will ever be.
alter table public.albums enable row level security;

drop policy if exists "signed-in read"   on public.albums;
drop policy if exists "signed-in write"  on public.albums;
create policy "signed-in read"  on public.albums for select to authenticated using (true);
create policy "signed-in write" on public.albums for all    to authenticated using (true) with check (true);
