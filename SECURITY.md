# Sécurité de ScanLinkPay

Ce document décrit les défenses en place et ce qu'il reste à faire. Il est tenu à jour avec le code.

## Défenses en place

### Base de données (Supabase)
- Seul le serveur API (clé `service_role`) peut exécuter les fonctions SQL qui déplacent de l'argent (`043`).
- Plus aucune écriture directe sur les tables depuis le navigateur (`044`).
- Colonnes secrètes (PIN, 2FA, mot de passe du stock) invisibles pour l'API REST publique (`045`).
- Mouvements d'argent atomiques, idempotents, avec verrous de lignes (portefeuilles, remboursements, retraits, tontines, caisse).
- Les soldes se déduisent du grand livre (`ledger_entries`), jamais d'un compteur modifiable.

### API (NestJS)
- `helmet`, CORS restreint, validation stricte des entrées (`whitelist` + `forbidNonWhitelisted`).
- Limites de débit : 100 requêtes/min/IP par défaut ; plus strictes sur l'inscription (5 / 10 min), la connexion (10 / min), le rafraîchissement, le changement de mot de passe et le déverrouillage WebAuthn.
- Verrouillage par compte : 5 mots de passe faux en 15 min → connexion bloquée 15 min (`LoginAttemptsService`).
- PIN de transaction haché, bloqué après 5 essais.
- Une seule session active par compte (hors admins).
- Contrôle des sorties d'argent (`RiskService.assessOutflow`) : trop d'opérations en une heure, envoi à trop de portefeuilles différents en 10 minutes, gros montant depuis un portefeuille de moins de 24 h → blocage et entrée dans `risk_logs`. Les très gros montants sont seulement signalés. Les admins consultent la liste via `GET /risk-logs`.
- **Code d'accès de l'application** (clients, marchands, patrons d'entreprise **et leurs employés** — vendeur, caissier, magasinier, comptable, caissier de marchand — chacun choisit son propre code ; pas les administrateurs qui ont la 2FA ; et jamais sur les écrans de caisse, de ventes, de stock, d'inventaire et d'encaissement, où le code n'est jamais demandé) : chaque compte choisit un code à 6 chiffres, obligatoire dès l'inscription (et à la première ouverture pour les comptes existants). C'est un contrôle d'**entrée** : jamais demandé quand on passe d'un onglet ou d'un écran à l'autre. L'application se verrouille à chaque lancement, après 15 s hors de l'application, et après un délai d'inactivité (3 min par défaut, réglable 1/3/5/15 min dans les Paramètres, défaut dans `lib/app-lock-store.ts`). Le code est vérifié par l'API (HMAC secret + bcrypt coût 12), jamais par le téléphone : 5 essais puis blocage de 15 min, et deux blocages de suite ferment la session. Les codes évidents (123456, dates, suites, répétitions) sont refusés. Modifier le code demande l'ancien puis le nouveau deux fois ; « code oublié » passe par le mot de passe du compte. L'empreinte/visage reste un raccourci facultatif.
- **Opérations de stock protégées par le mot de passe du patron** : le patron définit **un** mot de passe de gestion de stock et le communique à ceux qui gèrent le stock (jamais le code personnel). Il est exigé, vérifié par l'API, pour ajouter, modifier ou supprimer un article, enregistrer un mouvement de stock, valider un inventaire et archiver une vente (5 essais puis blocage 15 min ; mémorisé 5 minutes côté application pour saisir un lot). Seul le patron (ou un administrateur) peut le définir ou le changer ; seuls le patron, le personnel de la même entreprise et les administrateurs peuvent le vérifier. Vendre (scanner, encaisser) ne demande jamais de mot de passe. **Qui a fait quoi** reste connu même avec un mot de passe partagé : chaque employé agit depuis son propre compte, et l'API enregistre dans le journal d'audit (visible par le patron et le comptable, page « Journal ») les modifications d'articles (anciennes et nouvelles valeurs), les suppressions (ce que c'était), les mouvements de stock, les inventaires et les ventes archivées.
- **Caisse** : les mouvements d'espèces et la clôture de caisse, réservés au patron et au caissier, demandent le **code d'accès personnel** de la personne (jeton signé de 5 minutes vérifié par l'API — `AppCodeConfirmGuard`). Le code personnel sert sinon à l'entrée dans l'application.
- **Départ d'un employé** : le patron peut retirer l'accès (compte bloqué dans Supabase Auth, sessions coupées, historique conservé), changer un rôle ou rétablir un accès, avec son code d'accès personnel ; tout est journalisé (migration `051`, mais le blocage ne dépend pas d'elle).
- **Argent du commerce vs argent de l'employé** : les recettes arrivent dans le portefeuille du **patron** ; aucun employé n'y a accès (retraits, transferts et remboursements utilisent toujours le portefeuille de la personne connectée, et les remboursements sont réservés au marchand/admin). Chaque employé a **son propre portefeuille** (ouvert à la création du compte, ou à la première utilisation pour les comptes existants) où le patron lui envoie son salaire par transfert, et d'où il le retire vers Mobile Money (page « Mon portefeuille », code PIN de transaction, mêmes plafonds, frais et contrôles anti-fraude que tout le monde).
- **Accès administrateur** : un compte `admin` / `super_admin` ne fonctionne qu'avec le mot de passe **et** un code d'application d'authentification (TOTP, secret chiffré en base, code utilisable une seule fois, codes de secours hachés). Sans 2FA configurée, la session ne peut que configurer la 2FA (`JwtAuthGuard`). Jetons de rafraîchissement admin limités à 12 h. Liste d'IP autorisées optionnelle (`ADMIN_ALLOWED_IPS`).
- **Confirmation des actions sensibles** : changer un rôle, une commission, les frais/limites, les réglages de la plateforme ou réinitialiser la 2FA d'un collègue demande un code frais (`x-otp-code`, `OtpStepUpGuard`) ; impossible de changer son propre rôle ou de retirer le dernier super administrateur.
- **Alertes aux administrateurs** (cloche + notification push) : connexion admin, code 2FA faux, compte verrouillé, réseau admin non autorisé, opération bloquée par le moteur de risque, faux webhook de paiement, changement de rôle / commission / limites, réinitialisation de la 2FA, **portefeuille en négatif** (contrôle du grand livre toutes les 10 minutes).
- **Abonnement mensuel** : les outils d'une entreprise (caisse, ventes, stock, inventaire, statistiques, journal, ajout d'employés) sont inclus dans **un seul abonnement** payé par le patron, au mois, depuis son portefeuille (code PIN ; montant toujours recalculé par l'API à partir du prix fixé par le super admin ; paiement idempotent ; débit, trace et prolongation dans **une seule transaction SQL** — `purchase_subscription`, migration `052`). Le contrôle est fait par l'API (`@RequireSubscription`), pas seulement par l'écran : en « lecture simple » les lectures passent et les écritures sont refusées, en « bloqué » tout est refusé. Jamais bloqués : paiements des clients, portefeuille, retraits, retrait d'un employé. Prix, essai, modes et rappels ne se changent que par un super administrateur avec code frais (2FA), journalisés et signalés par alerte. Si les tables d'abonnement sont illisibles (migration oubliée, panne), l'API laisse passer : aucune entreprise n'est coupée par erreur. Les entreprises existantes ont un essai complet à partir de l'application de la migration. Limites connues : le rappel quotidien tourne sur chaque instance de l'API (à protéger par un verrou si vous passez à plusieurs instances) et l'état d'abonnement est mis en cache 15 secondes par instance.
- **Alertes critiques par SMS** (en plus de la cloche, du push et de l'email) : texte court sans rien de confidentiel, aux super admins (téléphone de leur profil, format international) et à `ALERT_SMS_TO` ; Africa's Talking ou Twilio selon `SMS_PROVIDER` ; frein de dépense (`SMS_MAX_PER_HOUR`, 10 par heure et par instance). Rien n'est envoyé tant qu'aucun fournisseur n'est configuré.
- **Session en cookies HttpOnly (navigateur, optionnel : `COOKIE_AUTH` + `VITE_AUTH_COOKIES`)** : les jetons ne sont plus lisibles par aucun script de la page, ni stockés dans le navigateur ; protection CSRF (SameSite=Strict + en-tête exigé + contrôle de l'origine) ; la session Supabase « temps réel » n'est pas donnée au navigateur dans ce mode. L'application Android garde l'en-tête `Authorization`. Détails et mise en route : `docs/COOKIES_HTTPONLY.md`.
- **Intégrité de l'appareil et de l'application Android (Google Play Integrity, `DEVICE_INTEGRITY_MODE` = off / warn / enforce)** : l'API vérifie auprès de Google que l'application est la nôtre, non modifiée, sur un appareil certifié (ni rooté ni émulé) ; en `enforce`, une session Android sans verdict fiable récent ne peut ni transférer ni retirer de l'argent. Détections de root locales (indicatives) transmises à l'API. Détails, limites et mise en place : `docs/ANDROID_INTEGRITY.md`.
- **Plusieurs instances de l'API** : les tâches planifiées (rappels, rapprochement des retraits, contrôle du grand livre, tontines) s'exécutent sur **une seule instance à la fois** grâce à un bail en base (`try_acquire_job_lock`, migration `053`) ; la limite de débit par IP est partagée via Redis (`REDIS_URL`, service Key Value de Render) avec repli sur la mémoire si Redis tombe.
- **Revue de sécurité (relectures indépendantes, constats vérifiés puis corrigés)** :
  - tentatives de connexion, de code 2FA et de PIN comptées *avant* la vérification, sous verrou de ligne (migration `055`) — une rafale de tentatives parallèles ne dépasse plus la limite ;
  - jetons des administrateurs révocables (déconnexion, réinitialisation de session ou de 2FA, changement de rôle) et âge absolu de session ; un jeton de rafraîchissement n'est plus accepté comme jeton d'accès ;
  - recharge créditée **une seule fois** quelle que soit la confirmation (webhook, double livraison, page de retour) — `complete_topup`, migration `056` ; le montant confirmé par le fournisseur doit être égal au montant enregistré ; montants avec centimes refusés pour un fournisseur qui facture en unités entières ;
  - retrait : demande **et** débit dans une seule transaction, et remboursement d'un retrait seulement si le débit existe (`request_withdrawal`, migration `057`) ;
  - paiement par portefeuille : le payeur n'est remboursé que si le marchand n'a pas été crédité ; une clé d'idempotence ne « rejoue » jamais l'opération d'un autre ni une autre opération ; une cotisation de tontine n'est « payée » que par un transfert réussi ;
  - remboursements refusés sur un portefeuille suspendu/gelé ou avant le crédit du marchand (migration `058`) ; plafonds comptés dans la devise concernée uniquement.
- Limites et frais de portefeuille configurables (`wallet_limits`).
- Webhooks PSP signés, rejouables sans effet, fournisseur vérifié.
- Journal d'audit (`audit_logs`) sur les actions sensibles.
- Documentation Swagger désactivée en production (`ENABLE_SWAGGER=true` pour la réactiver).

### Web / PWA
- Politique de contenu (CSP) : scripts uniquement depuis notre origine, pas de `eval`, pas d'iframe, pas de plugin (`render.yaml`).
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.
- Aucun `dangerouslySetInnerHTML` dans le code.

### Desktop (Electron) et Android
- Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, navigation externe bloquée, pas de `<webview>`, permissions limitées à la caméra et aux notifications depuis notre propre site, pont natif réservé à notre origine.
- Android : sauvegarde automatique désactivée (`allowBackup=false`), HTTP en clair autorisé seulement vers localhost.

### Chaîne de développement
- CI (`.github/workflows/security.yml`) : tests, vérification des types, audit des dépendances, détection de secrets.
- Dependabot pour les mises à jour de dépendances.

## À faire (priorité décroissante)

1. **Appliquer les migrations `040` à `058`**, puis lancer `linkpay-api/supabase/verify_security.sql` (voir `docs/LAUNCH_CHECKLIST.md`) dans le SQL Editor de Supabase, dans l'ordre, puis lancer le *Security Advisor* de Supabase.
2. **Changer toutes les clés déjà partagées** : `service_role` Supabase, `JWT_SECRET`, mot de passe CinetPay, clé FCM.
3. Vérifier `ledger_entries` (types `ADJUSTMENT` et `TOPUP`) pour détecter un éventuel abus avant la migration `043`.
4. Fermer ou contrôler l'inscription publique de Supabase Auth (l'inscription doit passer par `/auth/register`).
5. **Jetons de session** : le mode « cookies HttpOnly » est écrit et testé, mais **désactivé par défaut** ; il demande que le site web et l'API soient sur le même site (relais `/api/*` de `render.yaml` ou sous-domaines) et une vérification de l'IP vue par l'API : suivre `docs/COOKIES_HTTPONLY.md`. L'application Android garde ses jetons en stockage applicatif.
6. **Dépendances** : plus aucune faille « high » ou « critique » dans ce qui est déployé (`npm audit --omit=dev`, vérifié par la CI). Il reste des failles « moderate » sans correctif sans changement majeur ; la montée vers NestJS 12 n'est pas urgente et se fera avec une recette complète.
7. **Plusieurs instances de l'API** : traité (verrou des tâches en base, limite de débit sur Redis). Restent par instance : la déduplication des alertes (10 min), le frein SMS et le cache d'abonnement (15 s) — sans conséquence grave. À vérifier une fois en conditions réelles avec deux instances.
8. **Mobile** : détection de root et vérification d'intégrité **écrites, compilées et testées côté ordinateur**, mais à **tester sur de vrais téléphones** avant `enforce` (voir `docs/ANDROID_INTEGRITY.md`) ; l'épinglage de certificat (certificate pinning) n'est pas fait. iOS : non traité (pas d'application iOS dans ce dépôt).
9. **SMS** : fait (Africa's Talking ou Twilio). À configurer et à tester avec un vrai fournisseur ; l'envoi n'a été vérifié qu'avec un faux serveur.
10. **Test d'intrusion** par un tiers avant la mise en production, et sauvegardes Supabase (avec un test de restauration).

## Points connus, non corrigés (décisions ou travaux à planifier)

- **Tontine** : le créateur peut inviter quelqu'un après le tirage au sort ; l'invité accepte seul, ce qui ajoute un tour de cotisation à tous les membres sans leur accord. À décider : interdire les invitations une fois la tontine lancée, ou exiger l'accord des membres.
- **Application Android modifiée** : la plateforme de la session est annoncée par l'application à la connexion ; une version modifiée peut se dire « web » et échapper à la règle d'intégrité de l'appareil. Elle protège un téléphone compromis qui fait tourner la vraie application, pas un attaquant qui possède déjà les identifiants.
- **Plafonds de retrait/transfert** : la vérification est faite puis l'opération, en deux temps ; des requêtes parallèles peuvent dépasser un plafond journalier d'un petit nombre d'opérations (les plafonds par opération, le PIN verrouillé et le moteur de risque limitent les dégâts).
- **Jetons de rafraîchissement** : pas de rotation ni de détection de rejeu ; un jeton volé reste valable jusqu'à sa déconnexion (administrateurs : révocation et âge maximum 24 h).
- **Inscription** : l'adresse e-mail est marquée confirmée sans vérification, et « e-mail déjà utilisé » permet de savoir qu'un compte existe.
- Règlements manuels hérités (`fail_settlement`) : à revoir si l'ancien système est un jour réactivé.

## Signaler une faille

Écrire au responsable du projet. Ne pas publier la faille avant correction.
