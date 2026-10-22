# Décisions — ScanLinkPay (LinkPay)

Journal des décisions non triviales, les plus récentes en haut. À lire avant de toucher aux paiements, aux retraits ou
à la base. Toute nouvelle décision importante ajoute une section ici. L'état du travail et ce qui reste : `docs/REPRISE.md`.

---

## 21/10/2026 (soir) — Nouvelle interface (maquette ScanLinkPay 2026, clair et sombre)

Le propriétaire a fourni une maquette à suivre « textuellement » (écrans client et marchand, mode clair et sombre).
Choix faits avec lui : **client et marchand d'abord** (la charte s'applique partout, les écrans entreprise / caisse /
admin seront peaufinés ensuite) ; **« Mes dépenses » = camembert automatique + carnet manuel en dessous** ; **taux
CDF/USD indicatif réglé par le super admin** ; **avatar = silhouette** (pas de photo de profil pour l'instant).

- **Charte** (`linkpay-web/src/index.css`, `tailwind.config.js`) : **le bleu électrique du logo `#1230F8`** (22/10, demande du propriétaire,
  à la place du violet ; choisi pour ne pas ressembler au marine `#0F2742` / bleu `#1769E0` de HotelSaver) : dégradé
  `bg-brand-gradient` du bleu nuit `#0A1270` au bleu du logo (carte de solde, boutons, onglet actif), bleu ciel `#0EA5E9`
  en accent (titres en dégradé) ; **seule la page
  d'accueil (Welcome) garde le violet** (classe `theme-violet`) ; police **Inter** ;
  montants écrits « 2 950,00 CDF » / « 5,12 $US » (`formatCurrency`).
- **Thème** appliqué dès la première image, même avant la connexion : `public/theme-init.js` (fichier séparé : la CSP
  Android interdit les scripts en ligne).
- **Barres** : barre du haut (logo, cloche, avatar silhouette `UserAvatar`) ; barre du bas à plat, quatre onglets pour
  client et marchand : Accueil, Transactions, Encaisser / Recevoir, Plus (Paramètres passe dans Plus).
- **Onglet Transactions** (client, marchand) = historique du portefeuille (`/dashboard/wallet/transactions`) : recherche,
  Toutes / Entrées / Sorties, icônes colorées par type (`LedgerItem`). L'API ajoute `counterparty` à chaque ligne (nom de
  l'autre personne, du marchand, du réseau de retrait — affichage seulement, `withCounterparties`). L'ancienne page
  « Transactions » du marchand (paiements de ses clients, avec remboursements) s'appelle maintenant **« Paiements reçus »**.
- **Écrans d'argent** (Envoyer, Recharger, Retirer, Encaisser, Payer, PIN, nouvelle demande) : en **pleine page** sur
  téléphone (`FormSheet fullPage` : flèche retour + titre) au lieu du panneau qui monte du bas. Envoyer : bénéficiaire,
  montant, « ≈ x $US », montants rapides, motif. Retrait : on choisit d'abord le **point de retrait** (réseau ou banque).
- **Mes dépenses** : `GET /wallet/spending?period=1m|3m|6m&currency=` (débits du portefeuille par catégorie ; un retrait
  échoué et rendu ne compte pas) → camembert `SpendingOverview` ; le carnet manuel reste en dessous.
- **Taux indicatif** : colonne `platform_settings.cdf_per_usd` (migration **072**), lue publiquement
  (`GET /platform/settings`), réglée dans Administration → Frais et limites. **N'effectue jamais de conversion.**
- **Écran du code d'accès** aux couleurs de la charte (dégradé, carte et clavier qui suivent le thème).
- **Connexion / Inscription** (`components/auth/AuthShell.tsx`, `AuthField.tsx`) : même carte sur téléphone et ordinateur.
  Téléphone : en-tête dégradé + vague, carte en haut (pas recentrée à l'ouverture du clavier). Ordinateur : panneau
  « Bienvenue sur / Rejoignez ScanLinkPay » + trois atouts + illustration, lien de bascule en haut à droite. **Rien ne
  bouge pendant la saisie** : ligne de message réservée sous chaque champ, jauge du mot de passe toujours présente,
  champs en 16 px (pas de zoom), erreurs e-mail / mot de passe à la sortie du champ (vérifié : 0 px de décalage).
- **Écran du code PIN / code d'accès** (`components/PinKeypadScreen.tsx`, maquette « Écran d'authentification PIN ») :
  un seul écran pour toutes les saisies de code (ouverture de l'application, envoi, retrait, paiement, carte, épargne,
  tontine, abonnement…). Téléphone : dégradé bleu, logo, carte avec un point par chiffre et le numéro masqué
  (`•••••••567`), pavé de touches arrondies, « Entrée » en dégradé quand le code est complet. Ordinateur : barre
  (logo, « Sécurisé »), fond à courbes, tout dans une carte centrée. Pas de champ texte : rien ne bouge pendant la
  saisie (ligne d'erreur réservée). « Code oublié ? » s'ouvre dans une petite fenêtre (`PinDialog`) au-dessus de
  l'écran du code, flouté et assombri (Échap ou un appui à côté pour fermer).
- **Pages publiques** (lien de paiement, payer par numéro, résultat, retour de la banque, carte scannée) : cadre commun
  `components/public/PublicShell.tsx` (bande dégradée, logo, « Paiement sécurisé »). Le lien de paiement se lit comme un
  reçu (commerçant, gros montant, référence) puis « Payer avec mon solde » ou Mobile Money sans compte (le choix
  « Carte bientôt » est retiré de cette page). Payer par numéro : montant entier (les prestataires ne prennent pas de
  centimes), comme la recharge.
- **Écrans de résultat** (`components/ResultView.tsx`) : même écran partout (paiement, recharge, envoi, Pro, liens
  expirés) : grande icône, montant en gros, détails façon reçu avec référence copiable, actions.
- **Mot de passe oublié, nouveau mot de passe, code de secours, double authentification admin** : même cadre que la
  connexion (`AuthShell`, titre facultatif).
- **Pages du portefeuille et du marchand** : en-tête commun (`PageHeader`) avec bouton retour rond ; listes en français
  (plus de « PENDING » / « SUCCESS » : `TransactionItem`, demandes de paiement) avec filtres en pastilles
  (`components/ui/filter-chips.tsx`) ; Nouvelle demande et Encaisser par carte utilisent la même saisie de montant que
  la recharge (`AmountEntry`, montants entiers) ; Équipe affiche les rôles (Propriétaire / Caissier) ; Ma carte,
  Paramètres (préférences d'abord) et le scanner (cadre de visée, bouton manuel de nouveau lisible) retouchés.
  Tontines et Épargne ne sont pas retouchées : elles sont masquées (`lib/features.ts`).
- Vérification : banc de captures Playwright (API simulée) clair/sombre, `npm run build`, 722 tests API.

À faire : migration 072 (Test puis production) ; puis peaufiner les écrans entreprise, caisse, vendeur et admin avec
la même charte.

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
