-- ============================================================================
-- 033_stock_categories_and_password.sql — Categorized stock items with
-- per-category dynamic attributes, a product image, and an organization-wide
-- "stock management password" gate on editing/deleting an item.
--
-- Categories are a fixed 5-value enum (the sector-specific list the user
-- defined for "Shop d'appareils électroniques"), but the specs that go with
-- each one vary wildly (a CPU's socket vs a cable's connector type), so
-- they're NOT individual columns — `attributes` is a free-form JSONB bag the
-- frontend reads/writes per category via a shared config
-- (stock-categories.ts), same reasoning migration 031 gave for keeping
-- sector-specific stuff out of the schema where it could instead be
-- optional/JSONB.
--
-- The stock password is intentionally organization-wide (one shared secret
-- for the whole module, not per-user) — it protects against accidental
-- edits/deletes by anyone with stock access (owner or magasinier), not
-- against a specific user. Mirrors wallet_pin's shape (hash + attempt
-- counter + lockout) in wallet-pin.service.ts, just scoped to
-- organizations instead of profiles.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE stock_item_category AS ENUM (
    'telephonie_mobilite',
    'ordinateurs',
    'composants_informatiques',
    'audio_hifi',
    'accessoires'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS category stock_item_category;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(255);
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items(category);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stock_password_hash TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stock_password_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stock_password_locked_until TIMESTAMPTZ;

insert into storage.buckets (id, name, public, file_size_limit)
values ('product-images', 'product-images', true, 2097152)
on conflict (id) do update set file_size_limit = 2097152;

drop policy if exists "Public read access to product-images" on storage.objects;
create policy "Public read access to product-images"
  on storage.objects for select
  using (bucket_id = 'product-images');
