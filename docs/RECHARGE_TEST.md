# Argent de test (développeurs seulement)

**L'application ne crée jamais d'argent.** Il n'y a plus de prestataire « simulé » (`mock`) : chaque recharge, paiement,
abonnement ou retrait passe par un vrai prestataire (FlexPaie) avec de l'argent réel. Sans `PSP_PROVIDER` réglé sur un
vrai prestataire, l'API **refuse** les paiements (elle ne les fait plus « réussir » toute seule).

Pour tester, un développeur écrit de l'argent de test **directement dans la base**, depuis l'éditeur SQL de Supabase.

## Recharger un compte de test
Supabase → **SQL Editor** → New query :

```sql
SELECT credit_test_money('+243 81 234 56 78', 10000, 'CDF');   -- 10 000 CDF
SELECT credit_test_money('0812345678', 25, 'USD');             -- 25 USD
```

- Le compte est trouvé par son **numéro de téléphone** (toutes les écritures : `+243…`, `0…`, `243…`).
- Le portefeuille doit déjà exister (ouvrir le portefeuille une fois dans l'application).
- Le montant est en unités (pas en centimes).
- Ne **jamais** modifier un solde à la main dans le tableau : le solde est la somme des écritures (`ledger_entries`),
  `credit_test_money` passe par la même fonction que l'application.

## Ce que l'argent de test peut faire, et ne peut pas faire
Le portefeuille rechargé est marqué **portefeuille de test** (`wallets.is_test`). L'argent de test ne doit jamais devenir
de l'argent réel :

| Opération | Portefeuille de test |
|---|---|
| Payer un abonnement, une carte, Expense Pro | oui (l'argent reste chez ScanLinkPay) |
| Transférer vers un **autre portefeuille de test** | oui |
| Payer un marchand dont le propriétaire a un **portefeuille de test** | oui |
| **Retirer** (Mobile Money, banque) | **jamais** |
| Transférer vers un vrai portefeuille, payer un vrai marchand | **jamais** |
| Remboursement d'un marchand de test vers un vrai client | **jamais** |

Ces règles sont vérifiées par l'API **et** par la base elle-même (déclencheurs sur `withdrawals` et `transfers`) : un
chemin oublié dans le code ne suffit pas à faire sortir de l'argent de test.

Pour tester un parcours marchand, créer aussi le compte du marchand comme compte de test (lui créditer 1 CDF suffit à le
marquer).

## Reprendre l'argent de test
```sql
SELECT remove_test_money('0812345678', 'CDF');   -- reprend TOUT l'argent de test en CDF
SELECT remove_test_money('0812345678', 'USD');
```
Un portefeuille réel n'est jamais touché (la fonction refuse). Une fois vide dans les deux devises, le portefeuille peut
redevenir un portefeuille normal :
```sql
UPDATE wallets SET is_test = false WHERE id = '<id du portefeuille>';   -- refusé tant qu'il reste de l'argent
```

## Qui peut le faire
Seul l'éditeur SQL de Supabase (propriétaire de la base). Ni l'API, ni un utilisateur, ni un administrateur de
l'application ne peuvent appeler ces fonctions. Chaque écriture porte la mention `"source": "test-money"` dans ses
métadonnées (`ledger_entries.metadata`) et la référence `TEST-…`.

Migration : `linkpay-api/supabase/migrations/069_test_money.sql` (à exécuter avant de déployer l'API qui lit
`wallets.is_test`).

## Argent fictif déjà dans la base (à vérifier AVANT d'activer les retraits automatiques)
Avant cette version, le prestataire simulé `mock` créditait de **vrais** portefeuilles sans argent réel. Avec les
retraits automatiques, cet argent pourrait sortir en vrai. Cette requête (lecture seule, ne modifie rien) liste les
portefeuilles qui en ont reçu :

```sql
WITH fictif AS (
  SELECT wallet_id, currency, amount_cents, 'recharge mock' AS origine
    FROM wallet_topups WHERE psp_provider = 'mock' AND status = 'SUCCESS'
  UNION ALL
  SELECT recipient_wallet_id, currency, amount_cents, 'transfert payé par mock'
    FROM transfers WHERE psp_provider = 'mock' AND status = 'SUCCESS'
  UNION ALL
  SELECT t.credited_wallet_id, t.currency, t.net_cents, 'vente payée par mock'
    FROM transactions t JOIN payment_intents i ON i.id = t.payment_intent_id
   WHERE i.psp_provider = 'mock' AND t.credited_wallet_id IS NOT NULL
)
SELECT w.wallet_number, p.full_name, p.phone, f.currency, f.origine,
       SUM(f.amount_cents) / 100.0 AS montant_fictif,
       wallet_balance_cents(w.id, f.currency) / 100.0 AS solde_actuel
  FROM fictif f JOIN wallets w ON w.id = f.wallet_id LEFT JOIN profiles p ON p.id = w.user_id
 GROUP BY w.id, w.wallet_number, p.full_name, p.phone, f.currency, f.origine
 ORDER BY montant_fictif DESC;
```

Pour chaque portefeuille listé, décider (c'est une décision humaine : il peut aussi contenir de l'argent réel) :
- **compte de développeur ou de démonstration** → le marquer comme portefeuille de test, il ne pourra plus rien retirer :
  `UPDATE wallets SET is_test = true WHERE wallet_number = 'LP-…';`
- **vrai client** → retirer seulement la part fictive par une écriture inverse (jamais en modifiant un solde) :
  `SELECT debit_wallet('<id du portefeuille>', <montant en centimes>, 'ADJUSTMENT', 'FICTIF-RETIRE-<date>', 'CDF', '{"source":"nettoyage-mock"}');`

À faire **avant** `FLEXPAIE_PAYOUTS_ENABLED=true`.
