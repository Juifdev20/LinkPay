-- ============================================================================
-- 013_qr_codes_bucket.sql — Creates the 'qr-codes' Storage bucket.
--
-- payment-requests.service.ts has always uploaded generated QR PNGs to a
-- bucket named 'qr-codes', but it was never actually created — every upload
-- has been silently failing (qr_code_url stays undefined, no QR shown on
-- the merchant's "Demande créée !" screen). Public read, since the QR image
-- is rendered via a plain <img src> with no auth.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('qr-codes', 'qr-codes', true)
on conflict (id) do nothing;

drop policy if exists "Public read access to qr-codes" on storage.objects;
create policy "Public read access to qr-codes"
  on storage.objects for select
  using (bucket_id = 'qr-codes');
