-- Garage Crates: everything a new site needs, in one go.
-- Supabase → SQL Editor → New query → paste this whole file → Run. Safe to run again.
--
-- Signed-in accounts can read the collection. Only the owner (the FIRST account created on the
-- project, so create yours before any guest account) can add, change or delete anything.

-- ---------- the collection ----------
create table if not exists public.albums (
  id              uuid primary key default gen_random_uuid(),
  artist          text not null,
  title           text not null,
  catno           text,
  genres          text[]  not null default '{}',
  crates          text[]  not null default '{}',   -- your own groupings, e.g. 'Japanese'
  sort_as         text,                            -- "File under" override, e.g. 'Sun Ra'

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
  master_id       bigint,                          -- Discogs album family (all pressings)
  original_year   int,                             -- when the album first came out (its family's year); year is this pressing's
  price           jsonb,                           -- last marketplace check for want-list records
  tracks          jsonb   not null default '[]',   -- [{pos, title, dur}]
  credits         jsonb   not null default '[]',   -- [{name, id, roles[], kind, leader, tracks}]
  personnel_hint  text[]  not null default '{}',   -- player names from an imported spreadsheet

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

create index if not exists albums_crates_idx on public.albums using gin (crates);

alter table public.albums enable row level security;
drop policy if exists "signed-in read" on public.albums;
create policy "signed-in read" on public.albums for select to authenticated using (true);

-- ---------- cover images you upload ----------
-- A public folder so covers load quickly; file names are random and nothing lists them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

-- ---------- who owns the site ----------
create table if not exists public.site_owner (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.site_owner enable row level security;   -- no policies: only is_owner() reads it

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    case when exists (select 1 from public.site_owner)
      then exists (select 1 from public.site_owner where user_id = auth.uid())
      else auth.uid() = (select id from auth.users order by created_at asc limit 1)
    end, false);
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to anon, authenticated;

-- The owner is the first account created on this Supabase project, so create yours first.

-- ---------- site settings anyone can read (shown before signing in) ----------
create table if not exists public.site_settings (
  key   text primary key,
  value text
);
alter table public.site_settings enable row level security;
drop policy if exists "settings: anyone reads"  on public.site_settings;
drop policy if exists "settings: owner changes" on public.site_settings;
create policy "settings: anyone reads"  on public.site_settings for select to anon, authenticated using (true);
create policy "settings: owner changes" on public.site_settings for all to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.site_settings (key, value) values
  ('site_name',   'Garage Crates'),  -- the name at the top of the app
  ('guest_email', null)              -- the guest account's email; its password is the passphrase
on conflict (key) do nothing;

-- ---------- records: everyone signed in reads, only the owner writes ----------
drop policy if exists "signed-in write"  on public.albums;
drop policy if exists "owner adds"       on public.albums;
drop policy if exists "owner changes"    on public.albums;
drop policy if exists "owner deletes"    on public.albums;
create policy "owner adds"    on public.albums for insert to authenticated with check (public.is_owner());
create policy "owner changes" on public.albums for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes" on public.albums for delete to authenticated using (public.is_owner());

-- ---------- cover images: only the owner uploads or deletes ----------
drop policy if exists "covers: signed-in upload" on storage.objects;
drop policy if exists "covers: signed-in update" on storage.objects;
drop policy if exists "covers: signed-in delete" on storage.objects;
drop policy if exists "covers: owner uploads"    on storage.objects;
drop policy if exists "covers: owner replaces"   on storage.objects;
drop policy if exists "covers: owner deletes"    on storage.objects;
create policy "covers: owner uploads"  on storage.objects for insert to authenticated with check (bucket_id = 'covers' and public.is_owner());
create policy "covers: owner replaces" on storage.objects for update to authenticated using (bucket_id = 'covers' and public.is_owner());
create policy "covers: owner deletes"  on storage.objects for delete to authenticated using (bucket_id = 'covers' and public.is_owner());
