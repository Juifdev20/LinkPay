-- ============================================================================
-- verify_security.sql — READ-ONLY security check of the Supabase database.
--
-- Run it in the Supabase SQL editor AFTER migrations 040 → 048. It changes
-- nothing. Every row of the result is a check: the `status` column must read
-- OK. Anything marked FAIL names what to fix; anything marked REVIEW needs a
-- human look (the detail column says what to look at).
-- ============================================================================

WITH
-- 1. Nobody but the API may write to a table: the public app key must not be
--    able to INSERT/UPDATE/DELETE anything directly (migration 044).
writable AS (
  SELECT DISTINCT table_name || ' (' || grantee || ')' AS item
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
),
-- 2. Nobody but the API may run the money functions (migration 043). The five
--    small yes/no helpers used by row-level-security policies are expected.
callable AS (
  SELECT DISTINCT p.proname || ' (' || r.rolname || ')' AS item
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated')
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
     AND p.proname NOT IN ('is_admin', 'is_merchant_user', 'is_org_owner_of_merchant', 'is_stock_manager', 'is_tontine_member')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
-- 3. Every table has row-level security switched on.
no_rls AS (
  SELECT c.relname AS item
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
),
-- 4. Secret columns cannot be read with the public key (migrations 045, 048).
secrets AS (
  SELECT t.tbl || '.' || t.col || ' (' || r.rolname || ')' AS item
    FROM (VALUES
      ('profiles', 'transaction_pin_hash'), ('profiles', 'pin_attempts'), ('profiles', 'pin_locked_until'),
      ('profiles', 'two_factor_secret'), ('profiles', 'two_factor_last_step'), ('profiles', 'two_factor_recovery_hashes'),
      ('profiles', 'active_session_id'), ('profiles', 'active_device_id'),
      ('organizations', 'stock_password_hash'), ('organizations', 'stock_password_attempts'), ('organizations', 'stock_password_locked_until')
    ) AS t(tbl, col)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = t.col
    CROSS JOIN pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated')
     AND has_column_privilege(r.rolname, ('public.' || quote_ident(t.tbl))::regclass, t.col, 'SELECT')
),
-- 5. The functions the API relies on exist (a migration was skipped otherwise).
expected_functions AS (
  SELECT f AS item
    FROM unnest(ARRAY[
      'credit_wallet', 'debit_wallet', 'transfer_wallet', 'credit_merchant_wallet', 'refund_to_client_wallet',
      'mark_withdrawal_processing', 'finish_withdrawal', 'fail_withdrawal', 'fail_settlement',
      'add_pos_payment', 'savings_pot_balances', 'claim_totp_step', 'consume_recovery_code', 'negative_wallet_balances', 'record_auth_failure', 'get_auth_lock', 'clear_auth_attempts'
    ]) AS f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = f)
)
SELECT '1. Aucune écriture directe depuis la clé publique' AS check_name,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END AS status,
       COALESCE(string_agg(item, ', '), 'aucune') AS detail FROM writable
UNION ALL
SELECT '2. Fonctions réservées à l''API',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END,
       COALESCE(string_agg(item, ', '), 'aucune') FROM callable
UNION ALL
SELECT '3. Sécurité par ligne (RLS) activée partout',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END,
       COALESCE(string_agg(item, ', '), 'aucune table sans RLS') FROM no_rls
UNION ALL
SELECT '4. Colonnes secrètes invisibles pour la clé publique',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END,
       COALESCE(string_agg(item, ', '), 'aucune colonne exposée') FROM secrets
UNION ALL
SELECT '5. Migrations appliquées (fonctions présentes)',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END,
       COALESCE('manquantes : ' || string_agg(item, ', '), 'toutes présentes') FROM expected_functions
UNION ALL
SELECT '6. Aucun portefeuille en négatif',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'FAIL' END,
       COALESCE(string_agg(wallet_id || ' ' || currency || ' ' || balance_cents, ', '), 'aucun')
  FROM (SELECT * FROM public.negative_wallet_balances() LIMIT 20) neg
ORDER BY 1;

-- ----------------------------------------------------------------------------
-- À REGARDER À LA MAIN (informations, pas de verdict automatique)
-- ----------------------------------------------------------------------------

-- A. Qui est administrateur, et avec ou sans double authentification ?
--    Tout 'admin' / 'super_admin' que vous ne reconnaissez pas est une urgence.
SELECT p.email, r.slug AS role, p.two_factor_enabled, p.two_factor_enrolled_at, p.created_at
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN profiles p ON p.id = ur.user_id
 WHERE r.slug IN ('admin', 'super_admin')
 ORDER BY r.slug, p.email;

-- B. Écritures du grand livre qui créent de l'argent « à la main » (ajustements
--    et recharges) sur les 90 derniers jours : chacune doit s'expliquer
--    (remboursement de retrait raté, recharge réellement payée…).
SELECT entry_type, count(*) AS nombre, sum(amount_cents) AS total_cents, currency,
       max(created_at) AS derniere
  FROM ledger_entries
 WHERE direction = 'credit'
   AND entry_type IN ('ADJUSTMENT', 'TOPUP')
   AND created_at > now() - interval '90 days'
 GROUP BY entry_type, currency
 ORDER BY entry_type;

-- C. Les 20 plus gros crédits de ces ajustements/recharges (cherchez l'inattendu).
SELECT created_at, wallet_id, entry_type, amount_cents, currency, reference
  FROM ledger_entries
 WHERE direction = 'credit' AND entry_type IN ('ADJUSTMENT', 'TOPUP')
 ORDER BY amount_cents DESC
 LIMIT 20;

-- D. Opérations suspectes déjà détectées et pas encore traitées.
SELECT created_at, risk_score, flags FROM risk_logs WHERE NOT resolved ORDER BY created_at DESC LIMIT 20;
