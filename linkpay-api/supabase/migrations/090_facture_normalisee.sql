-- ============================================================================
-- 090_facture_normalisee.sql — Facture normalisée (DGI, RDC) : les fondations.
--
-- Pour une entreprise SOUMISE (fiscal_profiles.enabled = true), chaque vente devient une facture normalisée :
-- ScanLinkPay (le « SFE ») envoie la facture à l'e-MCF de la DGI, compare les montants calculés par la DGI avec les
-- siens, confirme, et reçoit les éléments de sécurité (code DEF/DGI, code QR, compteurs). Rien n'est imprimé comme
-- facture sans ces éléments (note de service 01/022, 1.1.5). Les entreprises non soumises ne voient aucun changement.
-- Voir docs/FACTURE_NORMALISEE.md et DECISIONS.md (03/11/2026).
--
-- Contenu :
--   * fiscal_profiles            — NIF, régime TVA, mode de prix, jeton e-MCF CHIFFRÉ (jamais lu par le navigateur)
--   * stock_items (+ colonnes)   — groupe de taxation A–P, type d'article BIE/SER/TAX, code, taxe spécifique, unité
--   * normalized_invoice_counters + next_normalized_invoice_number() — numéro continu par entreprise et par année
--   * normalized_invoices / normalized_invoice_items — la facture telle qu'envoyée et normalisée (instantané figé)
--   * emcf_exchanges             — journal de CHAQUE demande et réponse e-MCF (date, heure, contenu) : jamais modifié
--
-- Montants : en centimes (BIGINT) comme partout dans ScanLinkPay ; la facture DGI est en CDF (l'équivalent USD est
-- indicatif : currency_code/currency_rate). Quantités : 3 décimales.
-- Sécurité : RLS activée SANS politique — seul le serveur (clé service_role) lit et écrit ces tables.
--
-- Exécuter une fois dans l'éditeur SQL de Supabase (d'abord « LinkPay Test »), après 089. Rejouable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fiscal_profiles — une ligne par entreprise
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_profiles (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Interrupteur général : tant qu'il est faux, aucune facture n'est envoyée à la DGI pour cette entreprise.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  nif VARCHAR(9) CHECK (nif IS NULL OR nif ~ '^[A-Z0-9]{9}$'),
  vat_regime VARCHAR(20) NOT NULL DEFAULT 'non_assujetti' CHECK (vat_regime IN ('assujetti', 'non_assujetti')),
  -- Mode du prix unitaire (1.5.3) : ttc = toutes taxes comprises (les prix actuels de ScanLinkPay), ht = hors taxe.
  price_mode VARCHAR(3) NOT NULL DEFAULT 'ttc' CHECK (price_mode IN ('ttc', 'ht')),
  -- Groupe appliqué aux produits qui n'en ont pas : K (non-assujetti) ou B (16 %) selon le régime, si NULL.
  default_tax_group CHAR(1) CHECK (default_tax_group IS NULL OR default_tax_group ~ '^[A-P]$'),
  -- Groupes autorisés pour cette entreprise (ceux de l'homologation de ScanLinkPay, au plus).
  allowed_tax_groups TEXT[] NOT NULL DEFAULT ARRAY['A', 'B', 'C', 'E', 'H', 'K', 'O'],
  -- Mentions de la facture (1.2.1 a–d) ; à défaut, celles de l'organisation.
  trade_name VARCHAR(255),
  address TEXT,
  phone VARCHAR(40),
  email VARCHAR(255),
  -- e-MCF
  emcf_environment VARCHAR(10) NOT NULL DEFAULT 'test' CHECK (emcf_environment IN ('test', 'production')),
  emcf_token_encrypted TEXT,              -- AES-256-GCM (clé serveur) ; jamais renvoyé par l'API
  emcf_token_hint VARCHAR(8),             -- 4 derniers caractères, pour reconnaître le jeton à l'écran
  emcf_token_valid_until TIMESTAMPTZ,     -- « tokenValid » renvoyé par l'e-MCF
  emcf_nim VARCHAR(20),
  emcf_status VARCHAR(30),                -- Enregistré / Actif / Désactivé (dernier état lu)
  emcf_checked_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  activated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Pas d'activation sans NIF ni jeton.
  CHECK (NOT enabled OR (nif IS NOT NULL AND emcf_token_encrypted IS NOT NULL)),
  CHECK (allowed_tax_groups <@ ARRAY['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'])
);

DROP TRIGGER IF EXISTS set_updated_at ON fiscal_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fiscal_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE fiscal_profiles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Produits : ce que la DGI demande pour chaque article (1.1.16)
-- ----------------------------------------------------------------------------
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS tax_group CHAR(1);
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_tax_group_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_tax_group_check CHECK (tax_group IS NULL OR tax_group ~ '^[A-P]$');
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS dgi_item_type VARCHAR(3) NOT NULL DEFAULT 'BIE';
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_dgi_item_type_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_dgi_item_type_check CHECK (dgi_item_type IN ('BIE', 'SER', 'TAX'));
-- Code d'article envoyé à la DGI (à défaut : le code-barres). « HORS CHAMP » obligatoire pour une opération hors champ.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS dgi_item_code VARCHAR(50);
-- Taxe spécifique par unité (droits d'accises…), en centimes de la devise du produit.
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS specific_tax_cents BIGINT;
ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_specific_tax_check;
ALTER TABLE stock_items ADD CONSTRAINT stock_items_specific_tax_check CHECK (specific_tax_cents IS NULL OR specific_tax_cents >= 0);
ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20);

-- ----------------------------------------------------------------------------
-- Numérotation : série ininterrompue par entreprise et par année de gestion (1.1.15)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalized_invoice_counters (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 2024 AND 2200),
  last_number BIGINT NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (organization_id, fiscal_year)
);
ALTER TABLE normalized_invoice_counters ENABLE ROW LEVEL SECURITY;

-- Atomique : deux caisses qui facturent au même instant reçoivent deux numéros différents et consécutifs.
CREATE OR REPLACE FUNCTION public.next_normalized_invoice_number(p_organization_id UUID, p_fiscal_year INT)
RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO normalized_invoice_counters (organization_id, fiscal_year, last_number)
  VALUES (p_organization_id, p_fiscal_year, 1)
  ON CONFLICT (organization_id, fiscal_year)
  DO UPDATE SET last_number = normalized_invoice_counters.last_number + 1
  RETURNING last_number;
$$;
REVOKE ALL ON FUNCTION public.next_normalized_invoice_number(UUID, INT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- normalized_invoices — une facture normalisée (ou en cours de normalisation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalized_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  -- D'où vient la facture : un ticket de caisse, une vente, une note d'hôtel (HotelSaver), une saisie manuelle.
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('pos_ticket', 'sale', 'hotel', 'manual')),
  source_id TEXT,
  invoice_type VARCHAR(2) NOT NULL CHECK (invoice_type IN ('FV', 'FT', 'FA', 'EV', 'ET', 'EA')),
  fiscal_year INT NOT NULL,
  seq BIGINT NOT NULL,
  rn VARCHAR(30) NOT NULL,                       -- numéro de la facture du SFE, ex. « 2026/000123 »
  price_mode VARCHAR(3) NOT NULL CHECK (price_mode IN ('ttc', 'ht')),
  -- provisional : vendue sans réseau, bon provisoire non fiscal, à normaliser au retour du réseau
  -- pending     : demande envoyée à l'e-MCF, pas encore confirmée (expire au bout de 2 minutes côté DGI)
  -- confirmed   : normalisée — éléments de sécurité reçus, la seule qui s'imprime comme facture
  -- failed      : refusée par la DGI ou montants différents (code et description de l'erreur gardés)
  -- abandoned   : jamais normalisée et abandonnée (vente annulée avant normalisation) — raison obligatoire
  status VARCHAR(20) NOT NULL DEFAULT 'provisional'
    CHECK (status IN ('provisional', 'pending', 'confirmed', 'failed', 'abandoned')),
  client JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { type: PP|PM|PC|PL|AO, nif, name, contact, address }
  operator_id TEXT,
  operator_name VARCHAR(255) NOT NULL,
  payments JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ name: ESPECES|…, amount_cents, currency_code?, currency_rate? }]
  comments JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { cmta: "Réf. Exo. : …", … cmth }
  -- Équivalent en devise (1.1.30) : vide pour une facture purement en CDF.
  currency_code VARCHAR(8),
  currency_rate NUMERIC(14, 4) CHECK (currency_rate IS NULL OR currency_rate > 0),
  currency_date TIMESTAMPTZ,
  -- Avoir (FA, EA) : facture d'origine + nature (COR correction, RAN annulation, RAM reprise, RRR remise).
  original_invoice_id UUID REFERENCES normalized_invoices(id) ON DELETE RESTRICT,
  reference_code VARCHAR(29),                    -- code DEF/DGI de l'origine, ou « RRR »
  reference_type VARCHAR(3) CHECK (reference_type IS NULL OR reference_type IN ('COR', 'RAN', 'RAM', 'RRR')),
  reference_desc VARCHAR(40),
  -- Nos montants (moteur de calcul) et ceux de l'e-MCF : ils doivent être identiques avant de confirmer.
  computed_totals JSONB,
  emcf_totals JSONB,
  total_cents BIGINT CHECK (total_cents IS NULL OR total_cents > 0),   -- pas de facture nulle ou négative (1.1.21)
  vat_cents BIGINT CHECK (vat_cents IS NULL OR vat_cents >= 0),
  -- e-MCF
  emcf_environment VARCHAR(10) CHECK (emcf_environment IS NULL OR emcf_environment IN ('test', 'production')),
  emcf_uid VARCHAR(36),
  emcf_requested_at TIMESTAMPTZ,
  emcf_datetime VARCHAR(19),                     -- « dateTime » de la facture renvoyé par l'e-MCF
  code_def_dgi VARCHAR(29),
  qr_code TEXT,
  counters VARCHAR(40),
  nim VARCHAR(20),
  last_error_code VARCHAR(20),
  last_error_desc TEXT,
  attempts INT NOT NULL DEFAULT 0,
  request_snapshot JSONB,                        -- exactement ce qui a été envoyé (sans le jeton)
  abandoned_reason TEXT,
  print_count INT NOT NULL DEFAULT 0,            -- > 0 : toute réimpression porte la mention DUPLICATA
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, rn),
  UNIQUE (organization_id, fiscal_year, seq),
  CHECK ((invoice_type IN ('FA', 'EA')) = (reference_type IS NOT NULL)),
  CHECK (invoice_type NOT IN ('FA', 'EA') OR reference_type = 'RRR' OR original_invoice_id IS NOT NULL),
  CHECK (status <> 'confirmed' OR (code_def_dgi IS NOT NULL AND qr_code IS NOT NULL AND total_cents IS NOT NULL)),
  CHECK (status <> 'abandoned' OR (abandoned_reason IS NOT NULL AND code_def_dgi IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_invoices_code ON normalized_invoices(code_def_dgi) WHERE code_def_dgi IS NOT NULL;
-- Une vente (ticket, vente, note) ne devient qu'UNE facture de vente ou d'acompte ; les avoirs peuvent être plusieurs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_normalized_invoices_source ON normalized_invoices(source_type, source_id)
  WHERE source_id IS NOT NULL AND invoice_type IN ('FV', 'FT', 'EV', 'ET') AND status <> 'abandoned';
CREATE INDEX IF NOT EXISTS idx_normalized_invoices_org_status ON normalized_invoices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_normalized_invoices_org_created ON normalized_invoices(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_normalized_invoices_original ON normalized_invoices(original_invoice_id);

DROP TRIGGER IF EXISTS set_updated_at ON normalized_invoices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON normalized_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Une facture normalisée est figée : ce qui a été échangé avec la DGI ne bouge plus (1.1.4). Seul le compteur
-- d'impressions (duplicata) peut encore changer.
CREATE OR REPLACE FUNCTION public.normalized_invoice_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Facture normalisée : suppression interdite'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'confirmed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.rn IS DISTINCT FROM OLD.rn
    OR NEW.total_cents IS DISTINCT FROM OLD.total_cents OR NEW.vat_cents IS DISTINCT FROM OLD.vat_cents
    OR NEW.code_def_dgi IS DISTINCT FROM OLD.code_def_dgi OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
    OR NEW.client IS DISTINCT FROM OLD.client OR NEW.payments IS DISTINCT FROM OLD.payments
    OR NEW.request_snapshot IS DISTINCT FROM OLD.request_snapshot OR NEW.emcf_totals IS DISTINCT FROM OLD.emcf_totals
  ) THEN
    RAISE EXCEPTION 'Facture normalisée : modification interdite';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_normalized_invoice_frozen ON normalized_invoices;
CREATE TRIGGER trg_normalized_invoice_frozen BEFORE UPDATE OR DELETE ON normalized_invoices
  FOR EACH ROW EXECUTE FUNCTION public.normalized_invoice_frozen();

ALTER TABLE normalized_invoices ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- normalized_invoice_items — les articles de la facture (instantané : nom, prix, groupe au moment de la vente)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS normalized_invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES normalized_invoices(id) ON DELETE CASCADE,
  line_no INT NOT NULL CHECK (line_no > 0),
  stock_item_id UUID REFERENCES stock_items(id) ON DELETE SET NULL,
  original_item_id UUID REFERENCES normalized_invoice_items(id) ON DELETE RESTRICT,  -- avoir : la ligne remboursée
  code VARCHAR(50),
  item_type VARCHAR(3) NOT NULL CHECK (item_type IN ('BIE', 'SER', 'TAX')),
  name VARCHAR(255) NOT NULL,
  unit_of_measure VARCHAR(20),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),     -- dans le mode de la facture, en CDF
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  tax_group CHAR(1) NOT NULL CHECK (tax_group ~ '^[A-P]$'),
  specific_tax_cents BIGINT CHECK (specific_tax_cents IS NULL OR specific_tax_cents >= 0),  -- pour toute la quantité
  original_price_cents BIGINT CHECK (original_price_cents IS NULL OR original_price_cents > 0),
  price_modification VARCHAR(60),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents > 0),     -- pas d'article nul ou négatif (1.1.22)
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_normalized_invoice_items_invoice ON normalized_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_normalized_invoice_items_original ON normalized_invoice_items(original_item_id);
ALTER TABLE normalized_invoice_items ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- emcf_exchanges — journal de chaque échange avec l'e-MCF (bonne pratique DGI : tout conserver)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emcf_exchanges (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES normalized_invoices(id) ON DELETE RESTRICT,
  environment VARCHAR(10) NOT NULL CHECK (environment IN ('test', 'production')),
  operation VARCHAR(20) NOT NULL CHECK (operation IN ('status', 'invoice', 'confirm', 'cancel', 'details', 'info')),
  http_method VARCHAR(6) NOT NULL,
  path TEXT NOT NULL,
  request_body JSONB,
  http_status INT,
  response_body JSONB,
  error TEXT,                                    -- réseau coupé, délai dépassé…
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emcf_exchanges_invoice ON emcf_exchanges(invoice_id);
CREATE INDEX IF NOT EXISTS idx_emcf_exchanges_org_created ON emcf_exchanges(organization_id, created_at);

CREATE OR REPLACE FUNCTION public.emcf_exchanges_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Journal e-MCF : les échanges ne se modifient pas et ne se suppriment pas';
END $$;
DROP TRIGGER IF EXISTS trg_emcf_exchanges_append_only ON emcf_exchanges;
CREATE TRIGGER trg_emcf_exchanges_append_only BEFORE UPDATE OR DELETE ON emcf_exchanges
  FOR EACH ROW EXECUTE FUNCTION public.emcf_exchanges_append_only();

ALTER TABLE emcf_exchanges ENABLE ROW LEVEL SECURITY;
