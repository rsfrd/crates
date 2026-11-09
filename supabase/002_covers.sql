-- Garage Crates update: your own cover images.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.

-- Remembers that you picked a cover yourself, so "Refresh details" never replaces it.
alter table public.albums add column if not exists cover_locked boolean not null default false;

-- A storage folder for covers you upload or save from links.
-- It's "public" so images load quickly in the app, but file names are random and nothing lists them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

-- Only you (signed in) can add, replace or delete cover files.
drop policy if exists "covers: signed-in upload" on storage.objects;
drop policy if exists "covers: signed-in update" on storage.objects;
drop policy if exists "covers: signed-in delete" on storage.objects;
create policy "covers: signed-in upload" on storage.objects for insert to authenticated with check (bucket_id = 'covers');
create policy "covers: signed-in update" on storage.objects for update to authenticated using (bucket_id = 'covers');
create policy "covers: signed-in delete" on storage.objects for delete to authenticated using (bucket_id = 'covers');
