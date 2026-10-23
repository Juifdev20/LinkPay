# Où nous en sommes (état au 21 octobre 2026) et ce qui reste

Décisions et raisons : `DECISIONS.md` (racine). Repères pour les agents : `AGENTS.md`.

**En attente de fusion** : la branche `claude/gifted-brahmagupta-o286hw` (retraits automatiques FlexPaie, sécurité,
suppression de l'argent fictif et de CinetPay, base de test). Ordre : migrations `067` → `071` en production, puis fusion
dans `main` (voir `DECISIONS.md`, « Déploiement »).

## En cours (23/10) — achats, fournisseurs, rapport des vendeurs, rôles, réseau de fournisseurs
Plan, décisions et **état de chaque phase** : `DECISIONS.md`, section du 23/10. Phases A, B et C faites (prix d'achat
et marge, fournisseurs, rapport des vendeurs, rôles du stock, réseau de fournisseurs payant). Reste : le fichier Excel
du modèle économique. Migrations `083` et `084` à exécuter, puis le prix CDF de l'abonnement Fournisseur.

## En place
- Nouvelle interface (maquette 2026, clair et sombre) pour client et marchand — `DECISIONS.md` (21/10 soir). Migration `072` (taux indicatif) à exécuter.
- Carte ScanLinkPay (impression, activation, paiement par scan avec PIN) — `docs/carte/`.
- FlexPaie : encaissement Mobile Money et carte bancaire, vérification et rattrapage automatiques — `docs/FLEXPAIE.md`.
- FlexPaie PayoutService : retraits Mobile Money automatiques (migration `067`, `FLEXPAIE_PAYOUTS_ENABLED`) ; retraits bancaires manuels — `docs/FLEXPAIE.md`, « Retraits automatiques ».
- Plus aucun argent fictif dans l'application (prestataire `mock` supprimé ; CinetPay, jamais utilisé, retiré du projet ; FlexPaie seul prestataire) ; argent de test uniquement depuis l'éditeur SQL, enfermé dans les portefeuilles de test (migration `069`) — `docs/RECHARGE_TEST.md`.
- Deux bases : production et « LinkPay Test » (développeurs, argent de test) — `docs/BASE_TEST.md`, construite avec `linkpay-api/supabase/base_test.sql` (`node supabase/construire-base-test.js`).
- Pause de 24 h sur toute sortie d'argent après un changement de mot de passe, PIN, téléphone ou e-mail (migration `068`, `src/common/security-hold.ts`).
- Pages de recharge modernes, numéro vérifié par opérateur (web + API), retour dans l'application.
- Retraits bancaires (et tous les retraits tant que `FLEXPAIE_PAYOUTS_ENABLED` n'est pas `true`) traités à la main par un admin (page « Retraits à traiter », alertes, compteur).
- Écrans de PIN et de verrouillage au même design.

## À faire côté Render / Supabase
- `PSP_PROVIDER=flexpaie` (obligatoire : sans lui, tout paiement est refusé) et les variables FlexPaie — `docs/RENDER_ENV.md`.
- Migrations 059 (cartes) et 060 (`flexpaie_orders`) si pas encore faites, puis 067 → 072 (avant le déploiement).
- Créer le projet Supabase « LinkPay Test » et y coller `linkpay-api/supabase/base_test.sql` — `docs/BASE_TEST.md`.
- Retraits automatiques : variables `FLEXPAIE_PAYOUT_*` (identifiants du PayoutService, mot de passe par défaut à changer), page « Retraits à traiter » vidée, argent fictif ancien traité (`docs/RECHARGE_TEST.md`), puis `FLEXPAIE_PAYOUTS_ENABLED=true` et un retrait réel de 100 CDF par réseau.
- `CARD_PAYMENTS_ENABLED=true` pour ouvrir la carte bancaire après un test réel (3 essais : payé, annulé, page fermée).
- Redéployer `linkpay-api` et `linkpay-web`, reconstruire l'APK Android.

## Attendu de FlexPaie
- Seulement les adresses de production du PayoutService (connexion, envoi, éventuellement vérification). Le reste n'est plus demandé : les choix appliqués sont dans `DECISIONS.md`.

## Sécurité à faire
- Changer le mot de passe de l'accès marchand FlexPaie et ceux des deux proxies vus sur une capture.
- Traiter l'argent fictif des anciennes recharges `mock` avant d'activer les retraits automatiques (requête dans `docs/RECHARGE_TEST.md` ; écriture inverse, jamais de modification directe d'un solde).

## Idées pour la suite
- Peaufiner avec la même charte les écrans entreprise, caisse, vendeur et administration.
- Supervision des paiements en attente (page de rapprochement avec les relevés FlexPaie).

## Intégrations (HotelSaver) — ajouts compatibles (15/10/2026)
- `POST /payment-requests/quick-pay` accepte en plus `commission_model` (`MERCHANT_PAID` par défaut, `CUSTOMER_PAID`, `SHARED`), `description` (≤ 200 caractères, nettoyée) et `expires_in_minutes` ; la réponse contient `fees` (commission ScanLinkPay, frais du fournisseur, total payé, net reçu). Sans ces champs, rien ne change.
- `GET /payment-requests/fees-preview?scanlinkpay_number=…&amount_cents=…&currency=…&commission_model=…` (public, 30/min) : montre les frais AVANT de créer quoi que ce soit.
- `POST /payments` et `GET /payments/status/:référence` renvoient aussi `fees_cents` et `total_cents` (ce que le payeur a réellement payé).
- Les commissions suivent les règles du super admin ScanLinkPay (par devise : USD et CDF), comme pour tout autre paiement.
