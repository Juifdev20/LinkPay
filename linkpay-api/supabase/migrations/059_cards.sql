-- ============================================================================
-- 059_cards.sql — The ScanLinkPay card.
--
-- One physical card per person (client, merchant, boss, employee…), printed by a
-- super admin, tied to the person's own wallet. Life of a card:
--
--   requested  the person asked for one in the app (optional: an admin can also
--              issue a card straight from the person's ScanLinkPay number)
--   issued     number and QR code are generated, the card is printed — NOT usable yet
--   active     the holder activated it in the app (card number + PIN): proves they
--              really hold the card. A card handed to the wrong person is useless.
--   frozen     the holder paused it (they can unfreeze it with their PIN)
--   blocked    lost / stolen / cancelled by an admin: final, a new card is issued
--   replaced   superseded by a newer card
--
-- The card holds NO balance and NO secret: the QR code is only an opaque token that
-- designates the card, and every payment still needs the holder's wallet PIN. The
-- card number is a 16-digit ISO/IEC 7812 number (Luhn check digit), different from
-- the wallet number: losing a card never changes the number everybody uses to pay you.
--
-- Paying: a merchant scans the card, creates a charge (card_charges) bound to a normal
-- payment request, the holder approves it in their app with the PIN, and the existing
-- wallet payment does the rest. A charge expires after a few minutes.
--
-- Everything here is for the API only (no direct access from the public key).
-- Run once in the Supabase SQL editor (after 058).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Printed on the signature panel as "Réf." so a card can be found from its print-out.
  serial_no BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'issued', 'active', 'frozen', 'blocked', 'replaced')),
  -- Filled when the card is issued.
  card_number VARCHAR(16) UNIQUE CHECK (card_number IS NULL OR card_number ~ '^[0-9]{16}$'),
  qr_token VARCHAR(24) UNIQUE,
  holder_name TEXT,
  expires_on DATE,
  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES auth.users(id),
  print_count INT NOT NULL DEFAULT 0,
  activated_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  blocked_reason TEXT,
  replaced_by UUID REFERENCES cards(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cards_issued_has_number CHECK (
    status IN ('requested', 'blocked', 'replaced') OR (card_number IS NOT NULL AND qr_token IS NOT NULL AND expires_on IS NOT NULL)
  )
);
-- ONE living card per person: requested / issued / active / frozen. Blocked and replaced cards are history.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cards_one_live_per_user
  ON cards(user_id) WHERE status IN ('requested', 'issued', 'active', 'frozen');
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_wallet ON cards(wallet_id);

CREATE TABLE IF NOT EXISTS card_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id),
  created_by UUID REFERENCES auth.users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) NOT NULL,
  -- pending → processing (the holder approved, the payment is running) → approved | pending again if the
  -- payment did not go through (wrong PIN, not enough money). declined / expired / cancelled are final.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'approved', 'declined', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_charges_card ON card_charges(card_id, status);
CREATE INDEX IF NOT EXISTS idx_card_charges_merchant ON card_charges(merchant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_card_charges_request ON card_charges(payment_request_id);

-- What the super admin decides: the contact printed on the back, the domain of the QR code,
-- how long a card is valid, the logos of the partners shown on the back.
CREATE TABLE IF NOT EXISTS card_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  service_phone TEXT,
  -- Printed on the back as the line to call when a card is lost or stolen.
  lost_card_phone TEXT,
  web_domain TEXT,
  validity_years INT NOT NULL DEFAULT 3 CHECK (validity_years BETWEEN 1 AND 10),
  -- [{ "name": "Orange Money", "image": "data:image/png;base64,..." }] — checked by the API (type, size, count).
  partner_logos JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);
ALTER TABLE card_settings ADD COLUMN IF NOT EXISTS lost_card_phone TEXT;
INSERT INTO card_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cards', 'card_charges', 'card_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- issue_card: turn a request (or nothing) into an issued card, atomically.
--   * the person already has a request          → that request becomes the issued card
--   * the person has a card and p_replace       → the old one is 'replaced', a new one is issued
--   * the person has a card and NOT p_replace   → CARD_ALREADY_EXISTS
-- A number or token collision raises unique_violation: the API retries with new values.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_card(
  p_user UUID,
  p_wallet UUID,
  p_holder_name TEXT,
  p_card_number VARCHAR,
  p_qr_token VARCHAR,
  p_expires_on DATE,
  p_admin UUID,
  p_replace BOOLEAN
) RETURNS SETOF cards
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live cards;
  v_new cards;
BEGIN
  PERFORM 1 FROM wallets WHERE id = p_wallet AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'CARD_WALLET_MISMATCH'; END IF;

  SELECT * INTO v_live FROM cards
   WHERE user_id = p_user AND status IN ('requested', 'issued', 'active', 'frozen')
   FOR UPDATE;

  IF FOUND AND v_live.status = 'requested' THEN
    UPDATE cards
       SET status = 'issued', card_number = p_card_number, qr_token = p_qr_token, holder_name = p_holder_name,
           expires_on = p_expires_on, issued_at = NOW(), issued_by = p_admin, updated_at = NOW()
     WHERE id = v_live.id
     RETURNING * INTO v_new;
    RETURN NEXT v_new;
    RETURN;
  END IF;

  IF FOUND THEN
    IF NOT p_replace THEN RAISE EXCEPTION 'CARD_ALREADY_EXISTS'; END IF;
    UPDATE cards SET status = 'replaced', blocked_at = NOW(), blocked_reason = 'replaced', updated_at = NOW() WHERE id = v_live.id;
    -- Anything the old card was about to charge is void.
    UPDATE card_charges SET status = 'cancelled', decided_at = NOW() WHERE card_id = v_live.id AND status IN ('pending', 'processing');
  END IF;

  INSERT INTO cards (user_id, wallet_id, status, card_number, qr_token, holder_name, expires_on, issued_at, issued_by)
  VALUES (p_user, p_wallet, 'issued', p_card_number, p_qr_token, p_holder_name, p_expires_on, NOW(), p_admin)
  RETURNING * INTO v_new;
  IF v_live.id IS NOT NULL THEN
    UPDATE cards SET replaced_by = v_new.id WHERE id = v_live.id;
  END IF;
  RETURN NEXT v_new;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.issue_card(UUID, UUID, TEXT, VARCHAR, VARCHAR, DATE, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_card(UUID, UUID, TEXT, VARCHAR, VARCHAR, DATE, UUID, BOOLEAN) TO service_role;
