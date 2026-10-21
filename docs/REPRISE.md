# Où nous en sommes (état au 10 octobre 2026) et ce qui reste

Tout le travail est dans `main` (dernière fusion : PR #25). Rien n'est en attente sur la branche de travail.

## En place
- Carte ScanLinkPay (impression, activation, paiement par scan avec PIN) — `docs/carte/`.
- FlexPaie : encaissement Mobile Money et carte bancaire, vérification et rattrapage automatiques — `docs/FLEXPAIE.md`.
- FlexPaie PayoutService : retraits Mobile Money automatiques (migration `067`, `FLEXPAIE_PAYOUTS_ENABLED`) ; retraits bancaires manuels — `docs/FLEXPAIE.md`, « Retraits automatiques ».
- Plus aucun argent fictif dans l'application (prestataire `mock` supprimé ; CinetPay, jamais utilisé, retiré du projet ; FlexPaie seul prestataire) ; argent de test uniquement depuis l'éditeur SQL, enfermé dans les portefeuilles de test (migration `069`) — `docs/RECHARGE_TEST.md`.
- Deux bases : production et « LinkPay Test » (développeurs, argent de test) — `docs/BASE_TEST.md`, construite avec `linkpay-api/supabase/base_test.sql` (`node supabase/construire-base-test.js`).
- Pause de 24 h sur toute sortie d'argent après un changement de mot de passe, PIN, téléphone ou e-mail (migration `068`, `src/common/security-hold.ts`).
- Pages de recharge modernes, numéro vérifié par opérateur (web + API), retour dans l'application.
- Retraits traités à la main par un admin (page « Retraits à traiter », alertes, compteur).
- Écrans de PIN et de verrouillage au même design.

## À faire côté Render / Supabase
- `PSP_PROVIDER=flexpaie` et les variables FlexPaie — `docs/RENDER_ENV.md`.
- Migrations 059 (cartes) et 060 (`flexpaie_orders`).
- `CARD_PAYMENTS_ENABLED=true` pour ouvrir la carte bancaire après un test réel (3 essais : payé, annulé, page fermée).
- Redéployer `linkpay-api` et `linkpay-web`, reconstruire l'APK Android.

## En attente de FlexPaie (message à leur envoyer)
- Adresses et identifiants de production du PayoutService.
- Format du rappel (callback), frais (Mobile Money ≈ 2,5 %, carte ≈ 3 %), montants avec centimes (USD), montants minimum/maximum, mode test, règlement (quand ils nous reversent), préfixes des opérateurs, cartes locales et prépayées.

## Sécurité à faire
- Changer le mot de passe de l'accès marchand FlexPaie et ceux des deux proxies vus sur une capture.
- Remettre à zéro les soldes fictifs de la simulation avant l'ouverture au public (écriture inverse dans le journal, jamais de modification directe d'un solde).

## Idées pour la suite
- Supervision des paiements en attente (page de rapprochement avec les relevés FlexPaie).
- Mettre en service les retraits automatiques (`docs/FLEXPAIE.md`, « Mise en service ») : tests réels de 100 CDF sur chaque réseau.

## Intégrations (HotelSaver) — ajouts compatibles (15/10/2026)
- `POST /payment-requests/quick-pay` accepte en plus `commission_model` (`MERCHANT_PAID` par défaut, `CUSTOMER_PAID`, `SHARED`), `description` (≤ 200 caractères, nettoyée) et `expires_in_minutes` ; la réponse contient `fees` (commission ScanLinkPay, frais du fournisseur, total payé, net reçu). Sans ces champs, rien ne change.
- `GET /payment-requests/fees-preview?scanlinkpay_number=…&amount_cents=…&currency=…&commission_model=…` (public, 30/min) : montre les frais AVANT de créer quoi que ce soit.
- `POST /payments` et `GET /payments/status/:référence` renvoient aussi `fees_cents` et `total_cents` (ce que le payeur a réellement payé).
- Les commissions suivent les règles du super admin ScanLinkPay (par devise : USD et CDF), comme pour tout autre paiement.
