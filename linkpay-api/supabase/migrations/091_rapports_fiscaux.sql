-- ============================================================================
-- 091_rapports_fiscaux.sql — Facture normalisée DGI : rapports X, Z et A (note de service 01/022, 1.3 et 1.4).
--
--   * Z  : clôture de la période écoulée depuis le dernier Z ; numéroté (Z n° 1, 2, 3…), il FERME la période.
--   * X  : rapport quotidien depuis le dernier Z (ne ferme rien) ; XP : rapport X d'une période choisie.
--   * A  : rapport des articles (vendus, retournés, en stock) depuis le dernier rapport A.
--
-- Chaque rapport est un instantané FIGÉ (data) gardé dans le journal électronique (1.1.20) : on ne le modifie ni ne
-- le supprime, on peut seulement le réimprimer. Les chiffres viennent des factures NORMALISÉES de l'entreprise.
-- Sécurité : RLS sans politique — seul le serveur lit et écrit.
--
-- Exécuter une fois dans l'éditeur SQL de Supabase (d'abord « LinkPay Test »), après 090. Rejouable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fiscal_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_type VARCHAR(2) NOT NULL CHECK (report_type IN ('X', 'XP', 'Z', 'A')),
  -- Numéro dans la série de son type (le Z n° 12 suit le Z n° 11) ; les X ne sont pas numérotés (0).
  seq INT NOT NULL DEFAULT 0 CHECK (seq >= 0),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL CHECK (period_end >= period_start),
  data JSONB NOT NULL,
  print_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deux clôtures ne peuvent pas porter le même numéro, même si deux personnes appuient en même temps.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_reports_seq ON fiscal_reports(organization_id, report_type, seq) WHERE seq > 0;
CREATE INDEX IF NOT EXISTS idx_fiscal_reports_org_type ON fiscal_reports(organization_id, report_type, period_end DESC);

-- Figé : seul le compteur d'impressions bouge.
CREATE OR REPLACE FUNCTION public.fiscal_report_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Rapport fiscal : suppression interdite'; END IF;
  IF NEW.data IS DISTINCT FROM OLD.data OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.report_type IS DISTINCT FROM OLD.report_type OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Rapport fiscal : modification interdite';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fiscal_report_frozen ON fiscal_reports;
CREATE TRIGGER trg_fiscal_report_frozen BEFORE UPDATE OR DELETE ON fiscal_reports
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_report_frozen();

ALTER TABLE fiscal_reports ENABLE ROW LEVEL SECURITY;
