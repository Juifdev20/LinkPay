-- 083 — Trésorerie de l'entreprise : dépenses par station + mot de passe « trésorerie » du patron.
-- Rejouable. Ne modifie aucun solde ni aucune écriture d'argent.

-- Une dépense peut être rattachée à une station (NULL = « Sans station », comptée dans « Toutes les stations »).
ALTER TABLE organization_expenses ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_org_expenses_station_date ON organization_expenses (organization_id, merchant_id, created_at DESC);

-- Mot de passe de l'écran Trésorerie (haché, jamais en clair), avec compteur d'essais et blocage temporaire.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS treasury_password_hash TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS treasury_password_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS treasury_password_locked_until TIMESTAMPTZ;
