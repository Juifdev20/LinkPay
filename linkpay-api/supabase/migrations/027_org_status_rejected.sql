-- ============================================================================
-- 027_org_status_rejected.sql — Adds 'rejected' to org_status.
--
-- Deliberately its own migration/transaction: Postgres forbids using a
-- brand-new enum value in the same transaction that adds it, and this
-- project's migrations are run one file at a time in the Supabase SQL
-- editor, so the next migration (028) — which relies on organizations
-- actually reaching 'rejected' — must run as a separate, later statement.
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TYPE org_status ADD VALUE IF NOT EXISTS 'rejected';
