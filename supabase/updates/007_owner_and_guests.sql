-- Garage Crates update: an owner who can change things, and guests who can only look.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- After this, signed-in accounts can still READ everything, but only the owner can add, change
-- or delete records and cover images. The owner is the first account created on the project
-- (yours), unless you name another one in site_owner.

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

-- Pin the current owner (your account, the first one created) so it never changes by accident.
insert into public.site_owner (user_id)
select id from auth.users order by created_at asc limit 1
on conflict do nothing;

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
