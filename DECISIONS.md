# Décisions — ScanLinkPay (LinkPay)

Journal des décisions non triviales, les plus récentes en haut. À lire avant de toucher aux paiements, aux retraits ou
à la base. Toute nouvelle décision importante ajoute une section ici. L'état du travail et ce qui reste : `docs/REPRISE.md`.

---

## 21/10/2026 — Retraits automatiques FlexPaie, plus d'argent fictif, base de test séparée

Branche `claude/gifted-brahmagupta-o286hw` (10 commits, de `b73ff34` à la dernière). **À fusionner dans `main` seulement
après les migrations en production** (voir « Déploiement » ci-dessous).

### 1. Retraits Mobile Money automatiques (FlexPaie PayoutService)
- **Quoi** : `FlexPaieAdapter.payout()` / `getPayoutStatus()` / `acceptPayoutCallback()`
  (`linkpay-api/src/payments/psp/providers/flexpaie.adapter.ts`, fin du fichier), d'après la « Documentation FlexPaie
  Payout » v1.03 (confidentielle, pas dans le dépôt) : connexion `POST …/api/v1/auth/authenticate` (jeton gardé jusqu'à
  une minute avant expiration), envoi `POST …/pay`, vérification `GET …/check/<orderNumber>`.
- **Pourquoi « sans admin »** : décision du propriétaire, les retraits Mobile Money ne passent plus par la page
  « Retraits à traiter ». Seuls les **retraits bancaires** restent manuels (FlexPaie n'envoie que vers le Mobile Money),
  ainsi que tous les retraits tant que `FLEXPAIE_PAYOUTS_ENABLED` n'est pas `true`.
- **Journal `flexpaie_payouts`** (migration `067`), écrit **avant** l'envoi : un retrait ne peut jamais partir deux fois.
  États : `SENDING`, `ACCEPTED`, `NOT_SENT`, `ABANDONED`.
- **Réponses FlexPaie** : `0XX0` accepté (suivi chaque minute) ; `0XX1` occupé → nouvel essai à la minute suivante,
  abandon et remboursement après 24 h ; `0XX2` solde FlexPaie insuffisant / `0XX4` jeton / connexion refusée →
  remboursement immédiat + alerte critique admins ; `0XX3` numéro non pris en charge, `0XX5` autre → remboursement avec le
  message.
- **Réponse perdue** (délai dépassé) : ni renvoyé ni remboursé ; le rappel FlexPaie apporte le numéro de commande
  (vérifié chez FlexPaie : notre référence + même montant + même devise). **Sans nouvelles après 30 min → remboursé**
  (choix du propriétaire). Si FlexPaie confirme plus tard l'envoi → alerte « Retrait payé ET remboursé ».
- **Là où la documentation se tait, choix appliqués** (le propriétaire ne veut plus poser de questions à FlexPaie) :
  même codes de statut que la vérification des paiements (même adresse `check`) : 0 envoyé, 2 en cours, 1/3/4/5 échoué,
  autre = on attend ; référence **neuve à chaque essai** `RET-<16 hex>-<essai>` (22–25 caractères) ; montants entiers,
  minimum **100 CDF / 1 USD**, refusés **avant** de débiter ; maximums = limites de retrait de l'administration ;
  jeton de vérification : PayoutService, puis reconnexion, puis jeton des paiements en dernier recours.
- **Anciens retraits manuels en attente** : envoyés automatiquement à l'activation (choix du propriétaire) → vider la page
  « Retraits à traiter » AVANT d'activer.
- **Couper `FLEXPAIE_PAYOUTS_ENABLED`** n'abandonne rien : un retrait déjà confié à FlexPaie reste suivi et n'apparaît
  jamais dans la page manuelle (`payoutsInFlight`).
- **Rappel** : `POST /api/v1/webhooks/payouts/flexpaie` (`wallets/withdrawal-callbacks.controller.ts`), jamais cru.
- Variables Render : `FLEXPAIE_PAYOUT_AUTH_URL`, `FLEXPAIE_PAYOUT_URL`, `FLEXPAIE_PAYOUT_CHECK_URL` (facultative),
  `FLEXPAIE_PAYOUT_USERNAME`, `FLEXPAIE_PAYOUT_PASSWORD`, `FLEXPAIE_PAYOUT_MERCHANT` (facultative),
  `FLEXPAIE_PAYOUTS_ENABLED=true` en dernier. Détail : `docs/FLEXPAIE.md`, `docs/RENDER_ENV.md`.

### 2. Sécurité (revue anti-fraude)
- **Pause de 24 h** (migration `068`, `src/common/security-hold.ts`) : après un changement de mot de passe (y compris par
  lien e-mail), de PIN (y compris le premier), de téléphone ou d'e-mail, **aucune sortie d'argent** : retrait, transfert,
  paiement marchand par le solde, remboursement marchand. Les dates sont posées par des déclencheurs (`profiles`,
  `auth.users`). Choix du propriétaire contre le vol de compte.
- Contrôle de risque des retraits : **refus** si l'historique est illisible (avant : passait).
- `amount_cents` d'un retrait : entier obligatoire.

### 3. Plus aucun argent fictif dans l'application
- **Prestataire `mock` supprimé** (il faisait « réussir » tout seul recharges, paiements, transferts financés, abonnement
  Pro, retraits, et c'était le défaut si `PSP_PROVIDER` manquait). Sans vrai prestataire, l'API **refuse**.
- **CinetPay supprimé** du projet (jamais utilisé) : adaptateur, `cinetpay-js`, variables `CINETPAY_*`. FlexPaie est le
  seul prestataire. L'abonnement Pro payé par le prestataire : route `pro/activate/mobile-money`, valeur
  `payment_method = 'mobile_money'` (migration `070`).
- **Argent de test** (migration `069`) : uniquement depuis l'éditeur SQL (`credit_test_money` / `remove_test_money`,
  interdits à l'API et aux utilisateurs). Le portefeuille devient `wallets.is_test` et l'argent reste **enfermé** :
  jamais de retrait, jamais vers un vrai portefeuille / marchand / client (API `src/common/test-money.ts` + déclencheurs).
- **Argent fictif déjà en base** (anciennes recharges `mock`) : requête de repérage dans `docs/RECHARGE_TEST.md`, à
  traiter **avant** d'activer les retraits automatiques (décision humaine pour chaque portefeuille).

### 4. Deux bases Supabase : production et « LinkPay Test »
- Migration `071` : chaque base est marquée `production` ou `test` **pour toujours** (`platform_environment`).
  Production : `credit_test_money` refusé. Test : l'API refuse **tout paiement réel** (lu au démarrage par `PspFactory`).
- La base de test se construit d'un coup avec `linkpay-api/supabase/base_test.sql` (généré par
  `node supabase/construire-base-test.js`, vérifié sur une base vide envoyé en un seul bloc comme l'éditeur Supabase).
  L'ancien `setup_new_project.sql` (arrêté à 023) est supprimé.
- Les migrations en double (033/036, 034/037, 035/038) sont identiques : une seule de chaque dans `base_test.sql`.
- Mode d'emploi : `docs/BASE_TEST.md`.

### Déploiement (dans cet ordre)
1. **Production → SQL Editor** : `067_flexpaie_payouts.sql`, `068_security_hold.sql`, `069_test_money.sql`,
   `070_expense_pro_payment_method.sql`, `071_platform_environment.sql`.
2. Vérifier sur Render `PSP_PROVIDER=flexpaie` (sinon tous les paiements sont refusés).
3. Fusionner la branche dans `main` (Render redéploie `linkpay-api` et `linkpay-web` : les deux ensemble, le site appelle
   la nouvelle route Pro).
4. Plus tard, pour les retraits automatiques : variables `FLEXPAIE_PAYOUT_*`, page « Retraits à traiter » vidée, argent
   fictif ancien traité, puis `FLEXPAIE_PAYOUTS_ENABLED=true` et un retrait réel de 100 CDF par réseau.

Si le code part avant les migrations : 067 → la page manuelle reste correcte ; 068, 069, 071 → simplement non appliqués
(journalisé) ; 070 → le paiement Pro par Mobile Money échoue jusqu'à la migration.

### Risques acceptés (coût pour ScanLinkPay, jamais pour le client)
- Remboursement après 30 min sans nouvelles alors que FlexPaie a quand même envoyé (alerte critique).
- Ancien retrait déjà payé à la main mais non marqué, renvoyé à l'activation (d'où « vider la page »).
- Statut de vérification : si FlexPaie utilisait un autre code que 2 pour « en cours », un retrait serait remboursé à
  tort ; les tests réels de 100 CDF le montreraient tout de suite.
