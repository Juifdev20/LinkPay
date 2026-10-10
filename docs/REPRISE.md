# Où nous en sommes (état au 10 octobre 2026) et ce qui reste

Tout le travail est dans `main` (dernière fusion : PR #25). Rien n'est en attente sur la branche de travail.

## En place
- Carte ScanLinkPay (impression, activation, paiement par scan avec PIN) — `docs/carte/`.
- FlexPaie : encaissement Mobile Money et carte bancaire, vérification et rattrapage automatiques — `docs/FLEXPAIE.md`.
- Pages de recharge modernes, numéro vérifié par opérateur (web + API), retour dans l'application.
- Retraits traités à la main par un admin (page « Retraits à traiter », alertes, compteur).
- Écrans de PIN et de verrouillage au même design.

## À faire côté Render / Supabase
- `PSP_PROVIDER=flexpaie` et les variables FlexPaie — `docs/RENDER_ENV.md`.
- Migrations 059 (cartes) et 060 (`flexpaie_orders`).
- `CARD_PAYMENTS_ENABLED=true` pour ouvrir la carte bancaire après un test réel (3 essais : payé, annulé, page fermée).
- Redéployer `linkpay-api` et `linkpay-web`, reconstruire l'APK Android.

## En attente de FlexPaie (message à leur envoyer)
- API d'envoi d'argent (retraits, règlements aux commerçants, remboursements).
- Format du rappel (callback), frais (Mobile Money ≈ 2,5 %, carte ≈ 3 %), montants avec centimes (USD), montants minimum/maximum, mode test, règlement (quand ils nous reversent), préfixes des opérateurs, cartes locales et prépayées.

## Sécurité à faire
- Changer le mot de passe de l'accès marchand FlexPaie et ceux des deux proxies vus sur une capture.
- Remettre à zéro les soldes fictifs de la simulation avant l'ouverture au public (écriture inverse dans le journal, jamais de modification directe d'un solde).

## Idées pour la suite
- Supervision des paiements en attente (page de rapprochement avec les relevés FlexPaie).
- Brancher l'envoi d'argent dès que FlexPaie fournit son API : `FlexPaieAdapter.payout()` et retirer `supportsPayout = false`.
- Règlements aux commerçants (non couverts par les retraits manuels).
