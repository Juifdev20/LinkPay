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
- **Abonnement mensuel** : les outils d'une entreprise (caisse, ventes, stock, inventaire, statistiques, journal, ajout d'employés) sont inclus dans **un seul abonnement** payé par le patron, au mois, depuis son portefeuille (code PIN ; montant toujours recalculé par l'API à partir du prix fixé par le super admin ; paiement idempotent ; débit, trace et prolongation dans **une seule transaction SQL** — `purchase_subscription`, migration `052`). Le contrôle est fait par l'API (`@RequireSubscription`), pas seulement par l'écran : en « lecture simple » les lectures passent et les écritures sont refusées, en « bloqué » tout est refusé. Jamais bloqués : paiements des clients, portefeuille, retraits, retrait d'un employé. Prix, essai, modes et rappels ne se changent que par un super administrateur avec code frais (2FA), journalisés et signalés par alerte. Si les tables d'abonnement sont illisibles, l'API laisse passer (aucune entreprise n'est coupée par une panne ou une migration oubliée).
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

1. **Appliquer les migrations `040` à `052`**, puis lancer `linkpay-api/supabase/verify_security.sql` (voir `docs/LAUNCH_CHECKLIST.md`) dans le SQL Editor de Supabase, dans l'ordre, puis lancer le *Security Advisor* de Supabase.
2. **Changer toutes les clés déjà partagées** : `service_role` Supabase, `JWT_SECRET`, mot de passe CinetPay, clé FCM.
3. Vérifier `ledger_entries` (types `ADJUSTMENT` et `TOPUP`) pour détecter un éventuel abus avant la migration `043`.
4. Fermer ou contrôler l'inscription publique de Supabase Auth (l'inscription doit passer par `/auth/register`).
5. **Jetons de session** : ils sont dans `localStorage`. Un cookie `HttpOnly` serait plus sûr contre le vol par XSS, mais il change tout le flux de connexion (web, Electron, Android) ; la CSP réduit déjà le risque. À planifier séparément.
6. **Dépendances** : plus aucune faille « high » ou « critique » dans ce qui est déployé (`npm audit --omit=dev`, vérifié par la CI). Il reste des failles « moderate » sans correctif sans changement majeur ; la montée vers NestJS 12 n'est pas urgente et se fera avec une recette complète.
7. **Plusieurs instances de l'API** : le verrouillage de connexion et de la 2FA est partagé via la base (migration `049`). Reste la limite de débit par IP (`@Throttle`), encore en mémoire par instance : à déplacer vers un stockage partagé (Redis) si vous passez à plusieurs instances.
8. **Mobile** : détection de téléphone « rooté », vérification d'intégrité de l'application (Play Integrity), épinglage de certificat — nécessitent des plugins natifs et un test sur appareil.
9. **SMS** pour les alertes critiques (l'email via Resend est fait, voir `.env.example`) : à ajouter quand un fournisseur couvrant la RDC est choisi.
10. **Test d'intrusion** par un tiers avant la mise en production, et sauvegardes Supabase (avec un test de restauration).

## Signaler une faille

Écrire au responsable du projet. Ne pas publier la faille avant correction.
