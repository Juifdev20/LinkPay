-- ============================================================================
-- 094_historique_groupes.sql — Facture normalisée : journal de tous les changements de groupe de taxation.
--
-- Chaque fois qu'un groupe change (sur un produit, sur une catégorie, ou le groupe par défaut de l'entreprise), l'API
-- écrit une ligne : qui, quand, quoi, ancienne et nouvelle valeur. Le journal est en ajout seul : une ligne ne peut
-- plus être modifiée ni supprimée (même par l'API), pour que le patron comme le contrôleur puissent s'y fier.
--
-- Pas de clé étrangère volontairement : l'historique survit à la suppression d'un produit ou d'une personne.
-- Tout passe par l'API (service_role). À exécuter une fois dans l'éditeur SQL de Supabase, après 093. Rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fiscal_group_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('product', 'category', 'default')),
  -- Identifiant du produit, nom de la catégorie, ou NULL pour le groupe par défaut.
  subject_id TEXT,
  -- Nom lisible au moment du changement (le produit peut être renommé ou supprimé ensuite).
  subject_label TEXT,
  old_group CHAR(1) CHECK (old_group IS NULL OR old_group ~ '^[A-P]$'),
  new_group CHAR(1) CHECK (new_group IS NULL OR new_group ~ '^[A-P]$'),
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (old_group IS DISTINCT FROM new_group)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_group_history_org ON fiscal_group_history(organization_id, changed_at DESC);

ALTER TABLE fiscal_group_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fiscal_group_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON fiscal_group_history TO service_role;

-- Ajout seul : ni modification ni suppression, quel que soit le rôle.
CREATE OR REPLACE FUNCTION public.fiscal_group_history_immuable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Le journal des groupes de taxation est en ajout seul';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fiscal_group_history_immuable ON fiscal_group_history;
CREATE TRIGGER trg_fiscal_group_history_immuable
  BEFORE UPDATE OR DELETE ON fiscal_group_history
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_group_history_immuable();
