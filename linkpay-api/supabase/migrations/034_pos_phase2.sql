-- ============================================================================
-- 034_pos_phase2.sql — Module Supermarché, Phase 2: complète le POS selon le
-- cahier des charges (TVA, tickets en attente, annulation de ligne avec
-- autorisation, multi-paiement, reçus numérotés).
--
-- Décisions de modélisation :
--
-- * Les prix affichés en rayon sont TTC (usage retail en RDC) — la TVA est
--   donc EXTRAITE du total : tva = total × taux / (100 + taux), et
--   subtotal_cents devient le HT (total_cents reste le montant à payer,
--   inchangé pour les tickets existants). Le taux est par boutique
--   (merchants.pos_tva_rate_pct, 16% par défaut — taux RDC — modifiable).
--
-- * Les lignes annulées ne sont plus supprimées mais marquées 'voided' avec
--   qui/quand/pourquoi/qui-a-autorisé — le spec exige la traçabilité des
--   annulations, une ligne supprimée ne laisse aucune trace.
--
-- * pos_ticket_payments permet de combiner plusieurs modes sur un même
--   ticket (ex: partie espèces + reste en ScanLinkPay). payment_method sur
--   pos_tickets devient 'mixed' dans ce cas. Une ligne ScanLinkPay démarre
--   'pending' et passe 'confirmed' quand la payment_request liée est PAID —
--   le ticket n'est soldé que quand les paiements confirmés couvrent le
--   total.
--
-- * ticket_number : numérotation lisible par boutique (compteur
--   merchants.pos_ticket_seq incrémenté atomiquement par le backend),
--   pour les reçus — plus parlant qu'un UUID tronqué sur papier.
--
-- Run once in the Supabase SQL editor, same as previous migrations.
-- ============================================================================

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pos_tva_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 16;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pos_ticket_seq BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS ticket_number BIGINT;
ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS is_held BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS hold_note VARCHAR(120);
ALTER TABLE pos_tickets ADD COLUMN IF NOT EXISTS tva_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE pos_tickets DROP CONSTRAINT IF EXISTS pos_tickets_payment_method_check;
ALTER TABLE pos_tickets ADD CONSTRAINT pos_tickets_payment_method_check
  CHECK (payment_method IN ('cash', 'scanlinkpay', 'mixed'));

-- Backfill : numéroter les tickets existants dans l'ordre de création, puis
-- aligner le compteur de chaque boutique sur son max.
UPDATE pos_tickets t SET ticket_number = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY merchant_id ORDER BY created_at) AS rn
  FROM pos_tickets
) sub
WHERE t.id = sub.id AND t.ticket_number IS NULL;

UPDATE merchants m SET pos_ticket_seq = COALESCE(
  (SELECT MAX(ticket_number) FROM pos_tickets WHERE merchant_id = m.id), 0
);

-- Numérotation atomique par boutique — le backend appelle cet RPC à la
-- création d'un ticket (pas de race possible entre deux caisses de la même
-- boutique). Les tickets annulés gardent leur numéro : les trous dans la
-- séquence sont normaux et attendus sur des reçus fiscaux.
CREATE OR REPLACE FUNCTION public.next_pos_ticket_number(p_merchant_id UUID)
RETURNS BIGINT LANGUAGE sql AS $$
  UPDATE merchants SET pos_ticket_seq = pos_ticket_seq + 1
  WHERE id = p_merchant_id RETURNING pos_ticket_seq;
$$;

ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE pos_ticket_items DROP CONSTRAINT IF EXISTS pos_ticket_items_status_check;
ALTER TABLE pos_ticket_items ADD CONSTRAINT pos_ticket_items_status_check
  CHECK (status IN ('active', 'voided'));
ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES auth.users(id);
ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS void_authorized_by UUID REFERENCES auth.users(id);
ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS voided_reason TEXT;
ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
-- Coût d'achat figé à la vente : la marge des stats reste juste même si le
-- prix d'achat du produit change ensuite.
ALTER TABLE pos_ticket_items ADD COLUMN IF NOT EXISTS cost_price_cents_snapshot BIGINT;

CREATE TABLE IF NOT EXISTS pos_ticket_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES pos_tickets(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'scanlinkpay')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  -- Espèces : montant remis par le client (pour calculer la monnaie à rendre).
  received_cents BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed')),
  payment_request_id UUID REFERENCES payment_requests(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_ticket_payments_ticket_id ON pos_ticket_payments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_pos_ticket_payments_payment_request_id ON pos_ticket_payments(payment_request_id);
CREATE INDEX IF NOT EXISTS idx_pos_tickets_merchant_status ON pos_tickets(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_tickets_session ON pos_tickets(cash_register_session_id);

ALTER TABLE pos_ticket_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_ticket_payments_select ON pos_ticket_payments;
CREATE POLICY pos_ticket_payments_select ON pos_ticket_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_payments.ticket_id AND public.is_stock_manager(t.merchant_id))
);
DROP POLICY IF EXISTS pos_ticket_payments_insert ON pos_ticket_payments;
CREATE POLICY pos_ticket_payments_insert ON pos_ticket_payments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_payments.ticket_id AND public.is_stock_manager(t.merchant_id))
);
DROP POLICY IF EXISTS pos_ticket_payments_update ON pos_ticket_payments;
CREATE POLICY pos_ticket_payments_update ON pos_ticket_payments FOR UPDATE USING (
  EXISTS (SELECT 1 FROM pos_tickets t WHERE t.id = pos_ticket_payments.ticket_id AND public.is_stock_manager(t.merchant_id))
);
