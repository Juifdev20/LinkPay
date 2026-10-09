# Check-list avant de manipuler de l'argent réel

Cochez dans l'ordre. Ne passez pas à l'étape suivante tant que la précédente n'est pas verte.

## 1. Base de données (Supabase → SQL Editor)

- [ ] Exécuter dans l'ordre les migrations `040` → `050` (dossier `linkpay-api/supabase/migrations`). **La 043 d'abord si vous ne pouvez pas tout faire** : sans elle n'importe qui peut créditer un portefeuille.
- [ ] Exécuter `linkpay-api/supabase/verify_security.sql`. **Les 6 premières lignes doivent toutes afficher `OK`.** Une ligne `FAIL` dit ce qu'il reste à corriger.
- [ ] Lire les 4 tableaux « à regarder à la main » en bas du résultat :
  - **A** : chaque administrateur est une personne que vous connaissez ;
  - **B et C** : chaque crédit `ADJUSTMENT` / `TOPUP` s'explique ;
  - **D** : les alertes de risque non traitées.
- [ ] Supabase → *Advisors* → *Security Advisor* : corriger chaque alerte rouge.
- [ ] Supabase → *Authentication* → *Providers/Sign In* : désactiver l'inscription publique directe (« Allow new users to sign up ») si l'application passe uniquement par `/auth/register`.
- [ ] Supabase → *Database → Backups* : sauvegardes quotidiennes actives, et **faire une restauration de test** sur un projet vide.

## 2. Secrets (Render → Environment, jamais dans Git ni dans une discussion)

- [ ] Nouvelle clé `service_role` Supabase (Settings → API → *Roll*), puis `SUPABASE_SERVICE_ROLE_KEY` mis à jour.
- [ ] Nouveau `JWT_SECRET` (48 caractères aléatoires minimum). Tous les utilisateurs devront se reconnecter.
- [ ] Nouveau mot de passe / clés CinetPay, nouvelle clé FCM.
- [ ] `APP_CODE_PEPPER` : 32+ caractères aléatoires, à définir **avant** que les utilisateurs choisissent leur code d'accès, puis ne plus jamais le changer (sinon tous devront en choisir un nouveau).
- [ ] `TWO_FACTOR_ENCRYPTION_KEY` : 32+ caractères aléatoires, à définir **avant** que les administrateurs activent la 2FA, puis ne plus jamais la changer.
- [ ] `NODE_ENV=production`, `ENABLE_SWAGGER=false`, `PSP_PROVIDER` = le vrai fournisseur (jamais `mock`).
- [ ] **Alertes par email** : créer un compte gratuit sur resend.com, vérifier votre domaine d'envoi, puis définir `RESEND_API_KEY` et `ALERT_EMAIL_FROM` (et `ALERT_EMAILS` pour des destinataires en plus). Tester : déclencher une alerte critique (ex. un mauvais code 2FA sur un compte admin) et vérifier la réception.
- [ ] Optionnel mais recommandé : `ADMIN_ALLOWED_IPS` si les administrateurs ont une IP fixe (bureau/VPN).

## 3. Comptes administrateurs

- [ ] Se connecter avec chaque compte admin : l'écran « Sécurisez votre compte administrateur » apparaît. Scanner le QR code avec Google/Microsoft Authenticator.
- [ ] **Enregistrer les codes de secours** hors de l'ordinateur (coffre de mots de passe, papier dans un lieu sûr).
- [ ] Au moins **deux** super administrateurs, chacun avec sa 2FA (si l'un perd son téléphone, l'autre peut le réinitialiser dans *Utilisateurs*).
- [ ] Mot de passe long et unique pour chaque admin, jamais réutilisé ailleurs.
- [ ] Vérifier que la cloche reçoit bien une alerte « Connexion administrateur » à chaque connexion admin.

Si un super administrateur unique perd son téléphone **et** ses codes de secours, la récupération se fait en SQL (à faire avec une extrême prudence) :
`update profiles set two_factor_enabled = false, two_factor_secret = null, two_factor_recovery_hashes = '{}' where email = 'adresse@exemple.com';`

## 4. Paiements (avant le premier vrai franc)

- [ ] Tester chaque flux en **sandbox** du fournisseur (CinetPay / FlexPaie) avec de petits montants : recharge, paiement marchand, remboursement, retrait réussi, retrait échoué.
- [ ] Vérifier qu'un faux webhook (mauvaise signature) est rejeté **et** génère une alerte critique.
- [ ] Fixer des plafonds bas dans *Frais et limites* : par exemple 20 $ par opération et 50 $ par jour, et monter petit à petit.
- [ ] Prévoir un **compte de réserve** couvrant une perte possible les premières semaines.
- [ ] Vérifier avec un juriste les obligations en RDC pour un service de portefeuille (agrément, KYC, lutte anti-blanchiment).

## 5. Surveillance une fois en ligne

- [ ] Chaque jour : page *Alertes de sécurité* (tout est « traité »), et la cloche des administrateurs.
- [ ] Chaque semaine : relancer `verify_security.sql` ; vérifier le rapport GitHub *Security checks* et les propositions Dependabot.
- [ ] Après chaque nouvelle migration : relancer `verify_security.sql`.
- [ ] Une alerte « Portefeuille en négatif détecté » est une **urgence** : suspendre les retraits et examiner `ledger_entries`.

## 6. Avant d'ouvrir au public

- [ ] Test d'intrusion par un tiers, correction de tout ce qui est « critique » ou « haut ».
- [ ] Mise à jour majeure de NestJS (failles « high » restantes, voir `SECURITY.md`).
- [ ] Ouvrir à un petit groupe d'utilisateurs de confiance pendant 2 à 4 semaines.
