-- 089_profile_photos.sql — profile photos (clients, merchants) and company logos (enterprises).
--
-- Photos are shrunk by the API (sharp: a few tens of kilobytes, WebP, no metadata) and kept in the 'avatars' Storage
-- bucket under an unguessable name:  users/<user id>/<random>.webp  and  orgs/<organization id>/<random>.webp.
-- profiles.avatar_url already exists (migration 001); an organization gets its logo_url here. The bucket is public
-- (an object is read by its URL) and has NO select policy on purpose: a public bucket needs none, and without one the
-- list of files — and so of user ids — cannot be enumerated.
-- Replayable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 204800, array['image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 204800, allowed_mime_types = array['image/webp'];

alter table organizations add column if not exists logo_url text;
