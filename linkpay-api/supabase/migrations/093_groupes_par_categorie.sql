-- ============================================================================
-- 093_groupes_par_categorie.sql — Facture normalisée : un groupe de taxation par catégorie de produits.
--
-- Pour une entreprise, on dit « Boissons = groupe B, Fruits & légumes = groupe A… » une seule fois. À la facturation, le
-- groupe d'un article se décide dans cet ordre : le groupe du produit lui-même (stock_items.tax_group), sinon le groupe
-- de sa catégorie, sinon le groupe par défaut de l'entreprise. Aucun produit n'est modifié : changer une catégorie change
-- les prochaines factures de tous ses produits sans groupe propre (les factures déjà normalisées sont figées).
--
-- Tout passe par l'API (service_role). À exécuter une fois dans l'éditeur SQL de Supabase, après 092. Rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fiscal_category_groups (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Tel qu'enregistré sur le produit (stock_items.category) : « Boissons », « telephonie_mobilite »…
  category VARCHAR(100) NOT NULL CHECK (BTRIM(category) <> ''),
  tax_group CHAR(1) NOT NULL CHECK (tax_group ~ '^[A-P]$'),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, category)
);

ALTER TABLE fiscal_category_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fiscal_category_groups FROM PUBLIC, anon, authenticated;
GRANT ALL ON fiscal_category_groups TO service_role;

-- Les catégories réellement utilisées par les produits d'une entreprise (tous ses magasins), avec le nombre de produits.
CREATE OR REPLACE FUNCTION public.fiscal_organization_categories(p_org UUID)
RETURNS TABLE (category TEXT, products BIGINT)
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT si.category::TEXT, COUNT(*)::BIGINT
    FROM stock_items si
    JOIN merchants m ON m.id = si.merchant_id
   WHERE m.organization_id = p_org
     AND si.category IS NOT NULL
     AND BTRIM(si.category) <> ''
   GROUP BY si.category
   ORDER BY si.category
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.fiscal_organization_categories(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_organization_categories(UUID) TO service_role;
