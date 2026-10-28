# ScanLinkPay (LinkPay) — repères pour agents

À lire d'abord : `DECISIONS.md` (décisions et raisons, les plus récentes en haut) puis `docs/REPRISE.md` (état et ce qui
reste). Toute décision non triviale ajoute une section à `DECISIONS.md`.

## Structure
- `linkpay-api` : NestJS 10 (port 3000, préfixe `/api/v1`). `npm ci`, `npx tsc --noEmit -p tsconfig.json`, `npx jest`
  (~700 tests, ~2 min), `npx nest build`.
- `linkpay-web` : React 18 + Vite (PWA, Android via Capacitor). `linkpay-desktop` : application bureau.
- Base : Supabase (Postgres, RLS). Migrations SQL écrites à la main dans `linkpay-api/supabase/migrations/NNN_*.sql`,
  exécutées dans l'éditeur SQL de Supabase (pas de CLI). Déploiement : Render (`render.yaml`, fusion dans `main`).

## Règles d'argent (non négociables)
- **FlexPaie est le seul prestataire.** Pas de prestataire simulé (`mock`), pas de CinetPay : ne pas les réintroduire.
  Sans `PSP_PROVIDER` réel, l'API refuse les paiements.
- **L'application ne crée jamais d'argent.** L'argent de test s'écrit seulement dans la base « LinkPay Test » avec
  `credit_test_money` (éditeur SQL) ; il reste enfermé dans les portefeuilles `is_test` (`docs/RECHARGE_TEST.md`).
- Un solde est la somme de `ledger_entries` : jamais de modification directe d'un solde ; toujours `credit_wallet` /
  `debit_wallet` ou une écriture inverse.
- Retraits : le portefeuille est débité à la demande ; remboursement **seulement** sur échec confirmé (ou 30 min sans
  aucune nouvelle de FlexPaie). Tout passe par `finish_withdrawal` / `fail_withdrawal` (atomiques, idempotentes).
- Toute nouvelle sortie d'argent appelle `assertNoRecentSecurityChange` (pause 24 h) et `assertTestMoneyStaysInTests`.
- Le rappel (callback) FlexPaie n'est jamais cru : on relit toujours le statut chez FlexPaie.

## Bases et migrations
- Deux projets Supabase : production et « LinkPay Test » (`docs/BASE_TEST.md`), marqués pour toujours (migration 071).
- Nouvelle migration : d'abord sur LinkPay Test, puis sur la production au déploiement ; ensuite
  `node supabase/construire-base-test.js` (dans `linkpay-api`) et commiter `supabase/base_test.sql`.
- Une migration doit être rejouable sans erreur (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`).

## Secrets
Jamais dans le dépôt ni dans un message : clés Supabase `service_role`, `FLEXPAIE_TOKEN`, `FLEXPAIE_PAYOUT_PASSWORD`,
`JWT_SECRET`… Ils vivent dans Render et dans les `.env` locaux (ignorés par Git). La clé `anon` est publique par conception.
Les documentations FlexPaie sont confidentielles : on les résume dans `docs/FLEXPAIE.md`, on ne les copie pas.

## Hors ligne (règle de conception — la force du produit)
Les boutiques et supermarchés doivent pouvoir **vendre sans réseau** et synchroniser ensuite. Toute fonctionnalité qui écrit
sur le serveur répond à la question « et sans réseau ? » **avant d'être finie** :
- `linkpay-web/scripts/offline-manifest.mjs` déclare chaque fichier qui écrit (`offline`, `partial` ou `online` + la raison).
  `npm run check:offline` (avant chaque build et en CI) échoue si un fichier qui écrit n'y est pas.
- Ce qui peut attendre (une vente en espèces, un mouvement de stock, une note) passe par la file `enqueue` et un `client_ref`
  appliqué **une seule fois** côté serveur. Ce qui déplace de l'argent ScanLinkPay reste en ligne : écran sous `RequireOnline`
  (qui explique pourquoi), et le message général de `lib/api.ts` prévient si l'appel échoue faute de réseau.
- Un appel qui peut basculer sur le hors ligne passe `OFFLINE_FALLBACK` (attend 10 s, pas plus).
La marche à suivre complète, avec exemples : `docs/HORS_LIGNE.md`.
