-- ============================================================================
-- 029_staff_roles_seed.sql — Job-role slugs for enterprise-internal staff.
--
-- These are real system roles (same `roles` table as super_admin/admin/
-- enterprise/merchant/cashier/client, seeded in 002_seed_data.sql), not
-- mere display labels — reusing the existing single-role-per-JWT model and
-- @Roles()/RolesGuard infrastructure means future stock/caisse/ventes
-- endpoints can gate with e.g. @Roles('magasinier') the same way
-- admin.controller.ts already gates with @Roles('admin','super_admin').
-- permissions is left as the seed default ('[]'::jsonb, an empty array —
-- see roles.permissions in 001_initial_schema.sql) since no feature module
-- exists yet to define concrete permissions for; that's populated later as
-- each module (stock, caisse, ventes) is built.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

INSERT INTO roles (slug, name, description, is_system)
VALUES
  ('magasinier', 'Magasinier', 'Gère le stock et les réapprovisionnements d''une entreprise', false),
  ('vendeur', 'Vendeur', 'Réalise les ventes pour une entreprise', false),
  ('caissier', 'Caissier (entreprise)', 'Gère la caisse d''une entreprise', false),
  ('comptable', 'Comptable', 'Suit les finances et la comptabilité d''une entreprise', false)
ON CONFLICT (slug) DO NOTHING;
