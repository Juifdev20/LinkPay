# LinkPay — Paiements par lien et QR code en RDC

Plateforme de paiement PWA (mobile-first) permettant aux commerçants de créer des demandes de paiement instantanées via lien et QR code, avec règlements, remboursements, gestion d'équipe, temps réel et administration multi-rôles. Inclut aussi un portefeuille LinkPay (transferts P2P, recharge, retrait), des comptes Entreprise multi-boutiques (KYB, numéro ScanLinkPay pour être payé directement sans facture, tableau de bord récapitulatif), et un module Tontines (épargne collective).

## Architecture

```
LinkPay/
├── linkpay-api/              # Backend NestJS (API REST)
│   ├── src/
│   │   ├── auth/              # JWT (login, register, refresh, logout), session unique par appareil
│   │   ├── users/              # Profil utilisateur, stats client
│   │   ├── merchants/          # Boutiques, équipe (inviter/retirer un caissier)
│   │   ├── organizations/      # Comptes "entreprise" : KYB, multi-boutiques, numéro ScanLinkPay, dashboard, dépenses
│   │   ├── payment-requests/   # Demandes de paiement (lien + QR)
│   │   ├── payments/           # Paiement + adaptateurs PSP (mock, CinetPay)
│   │   ├── wallets/             # Portefeuille LinkPay (solde, PIN, transfert P2P, recharge, retrait)
│   │   ├── tontines/            # Épargne collective (cycles, cotisations, invitations, cron de rappel)
│   │   ├── transactions/       # Historique et reçus
│   │   ├── settlements/        # Règlements commerçants (solde, demande, traitement admin)
│   │   ├── refunds/            # Remboursements
│   │   ├── commissions/        # Règles de commission (admin)
│   │   ├── ledger/              # Grand livre (double entrée)
│   │   ├── notifications/      # Notifications utilisateur (API + temps réel)
│   │   ├── push-notifications/  # Web Push (VAPID) + notifications natives Android (FCM)
│   │   ├── webauthn/            # Verrouillage d'app par biométrie/clé de sécurité
│   │   ├── webhooks/            # Webhooks PSP
│   │   ├── risk/                # Scoring de risque (service interne)
│   │   ├── admin/               # Statistiques plateforme, rôles, réinitialisation de session
│   │   ├── audit/               # Logs d'audit (service interne)
│   │   └── supabase/            # Client Supabase (service_role + client dédié à l'auth)
│   └── supabase/
│       └── migrations/          # Schéma SQL, RLS, seed — voir "Base de données" ci-dessous
│
└── linkpay-web/               # Frontend React PWA (Vite), mobile-first
    ├── src/
    │   ├── components/          # PageHeader (en-têtes responsive), NotificationsBell, TransactionItem, BottomNav, ui/ (shadcn)
    │   ├── hooks/                # useRealtimeInvalidate (Supabase Realtime → React Query)
    │   ├── lib/                  # Client API (axios), client Supabase (realtime), store d'authentification (Zustand), utils
    │   ├── layouts/               # DashboardLayout (sidebar desktop / bottom nav mobile)
    │   ├── pages/
    │   │   ├── auth/               # Login, Register (choix Client / Marchand / Entreprise)
    │   │   ├── public/             # PaymentLink (paiement anonyme), PayByNumber (paiement par numéro ScanLinkPay), PaymentResult
    │   │   ├── merchant/           # Dashboard, PaymentRequests, Create, Transactions, Settlements, Team
    │   │   ├── client/             # Dashboard, Transactions, tontines/ (liste, création, détail)
    │   │   ├── wallet/             # Solde, envoi, réception, recharge, retrait, PIN, historique
    │   │   ├── admin/              # Dashboard, Merchants, Users, Settlements, Commissions
    │   │   ├── organization/       # OnboardingWizard (KYB en 6 étapes, obligatoire avant le dashboard)
    │   │   ├── OrganizationProfile.tsx  # Dashboard Entreprise (récapitulatif, ScanLinkPay, boutiques, dépenses)
    │   │   └── Settings.tsx        # Profil, gestion du compte
    │   └── App.tsx                # Routing avec ProtectedRoute par rôle
    └── vite.config.ts             # PWA (manifest, service worker) + proxy API
```

## Tech Stack

### Backend
- **NestJS** 10 + TypeScript strict
- **Supabase** (PostgreSQL, Row Level Security, Auth) — accès via `service_role` pour l'API, client Supabase dédié pour l'authentification (isolé pour ne jamais contaminer le contexte RLS des requêtes admin)
- **Supabase Realtime** — notifications et transactions poussées en direct au frontend
- **JWT** maison (access + refresh tokens) avec **session unique par compte** (un compte ne peut être connecté que sur un seul appareil à la fois ; réinitialisable par un admin)
- **RBAC** à 6 rôles : `super_admin`, `admin`, `enterprise`, `merchant`, `cashier`, `client`
- **Adaptateur PSP** (pattern extensible) : `mock` (démo, succès simulé) et `cinetpay` (Mobile Money RDC — Orange/Airtel/M-Pesa — + carte, préparé mais non testé en conditions réelles, voir `.env.example`)
- **Portefeuille LinkPay** : solde CDF/USD indépendants, numéro unique généré automatiquement, transfert P2P, PIN transactionnel, recharge/retrait
- **Tontines** : cycles d'épargne collective avec invitations, cotisations, et une tâche planifiée (`@nestjs/schedule`) pour les rappels
- **Push notifications** : Web Push (VAPID) pour la PWA, Firebase Cloud Messaging pour l'app Android (Capacitor)

### Frontend
- **React 18** + **Vite 5**
- **TypeScript** strict
- **TailwindCSS** 3 + **shadcn/ui** (composants Radix), design mobile-first avec en-têtes/actions adaptatifs (bouton flottant sur mobile, texte sur desktop)
- **React Router** v6 (routes protégées par rôle)
- **React Query** (données serveur) + **Supabase Realtime** (invalidation instantanée du cache au lieu du sondage)
- **Zustand** (état d'authentification)
- **Axios** (client API avec rafraîchissement automatique du token)
- **vite-plugin-pwa** (manifest, service worker, hors-ligne, écran non-zoomable façon app native)

## Démarrage local

### Prérequis
- Node.js 18+
- npm 9+
- Un compte [Supabase](https://supabase.com) (gratuit) — le projet utilise Supabase pour la base de données, l'authentification et le temps réel

### 1. Base de données (Supabase)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Dans l'éditeur SQL du projet (**SQL Editor**), exécuter **dans l'ordre** les fichiers de `linkpay-api/supabase/migrations/` :
   - `001_initial_schema.sql` — schéma complet (tables, enums, RLS)
   - `002_seed_data.sql` — rôles et règle de commission par défaut
   - `003_fix_rls_policies.sql` — politiques RLS
   - `004_merchant_users.sql` — table de gestion d'équipe (manquante dans le schéma initial)
   - `005_session_tracking.sql` — session unique par compte + activation Realtime sur `notifications`/`transactions`
   - `006_wallets.sql` — Portefeuille LinkPay (compte, numéro, recharge)
   - `007_wallet_phase2.sql` — PIN transactionnel, transfert P2P, retrait, limites
   - `008_multi_currency.sql` — support CDF/USD (sans conversion)
   - `009_device_binding.sql` — reprise de session sur le même appareil
   - `010_push_subscriptions.sql` — abonnements Web Push (VAPID)
   - `011_webauthn_credentials.sql` — verrouillage d'app par biométrie/clé de sécurité
   - `012_fcm_push_tokens.sql` — jetons de notifications natives Android (FCM)
   - `013_qr_codes_bucket.sql` — bucket Storage pour les QR codes générés
   - `014_organization_merchants.sql` — rattachement des boutiques à une organisation (multi-boutiques)
   - `015_slp_wallet_numbers.sql` — évolution du format des numéros de portefeuille
   - `016_tontines.sql` — épargne collective (cycles, cotisations, invitations)
   - `017_organization_kyb.sql` — profil KYB complet de l'entreprise (identité légale, activité, règlement, représentant légal)
   - `018_organization_scanlinkpay_number.sql` — numéro ScanLinkPay unique par entreprise (paiement direct sans facture)
   - `019_organization_expenses.sql` — suivi manuel des dépenses (tableau de bord Entreprise)
3. Récupérer dans **Project Settings → API** : l'URL du projet, la clé `anon`/`public`, et la clé `service_role`.

⚠️ Chaque nouvelle migration ajoutée au projet doit être exécutée manuellement de la même façon — elles ne s'appliquent jamais automatiquement.

### 2. Backend

```bash
cd linkpay-api
cp .env.example .env
# Éditer .env avec vos clés Supabase (voir ci-dessous)
npm install
npm run start:dev
```

Variables d'environnement (`linkpay-api/.env` — voir `linkpay-api/.env.example` pour la liste exhaustive commentée) :
```
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000

SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_ANON_KEY=votre-clé-anon
SUPABASE_SERVICE_ROLE_KEY=votre-clé-service-role
DATABASE_URL=postgresql://postgres:password@db.votre-projet.supabase.co:5432/postgres

JWT_SECRET=une-chaîne-secrète-longue
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=365d

# PSP — laisser "mock" pour développer sans compte prestataire réel
PSP_PROVIDER=mock
PSP_SANDBOX=true
# Si compte CinetPay actif (Mobile Money RDC) — nouvelle API panel.cinetpay.net :
# PSP_PROVIDER=cinetpay
# CINETPAY_API_KEY_CD=
# CINETPAY_API_PASSWORD_CD=
# PROXY_URL=   # requis en production (Render) pour le whitelisting IP CinetPay

# Web Push (VAPID) — notifications même app fermée, générer avec `npx web-push generate-vapid-keys`
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:contact@example.com

# Firebase Cloud Messaging — notifications natives pour l'app Android (Capacitor)
FCM_PROJECT_ID=
FCM_CLIENT_EMAIL=
FCM_PRIVATE_KEY=
```

L'API démarre sur `http://localhost:3000`, documentation Swagger sur `http://localhost:3000/api/v1/docs`.

### 3. Frontend

```bash
cd linkpay-web
cp .env.example .env
# Éditer .env avec l'URL/clé anon Supabase (mêmes valeurs que côté backend)
npm install
npm run dev
```

Variables d'environnement (`linkpay-web/.env`) :
```
VITE_API_URL=http://localhost:3000/api/v1
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-clé-anon
VITE_VAPID_PUBLIC_KEY=   # doit correspondre à VAPID_PUBLIC_KEY côté backend
```

Pour builder et tester l'app Android (Capacitor) sur un téléphone — y compris contre un backend local sans passer par Render — voir `TESTING_LOCAL.md` à la racine du dépôt.

L'application démarre sur `http://localhost:5173`.

### 4. Premiers comptes

Aucun compte n'est pré-créé. Inscrivez-vous depuis `/register` (choix Client, Marchand ou Entreprise). Un compte Entreprise doit obligatoirement terminer l'assistant de configuration KYB (identité légale, coordonnées, activité, règlement, représentant légal, branding) avant d'accéder à son tableau de bord. Pour obtenir un compte `admin`/`super_admin`/`cashier`, il faut soit :
- attribuer le rôle manuellement en base (table `user_roles`, via l'éditeur Supabase), soit
- créer un premier `super_admin` ainsi, puis utiliser la page **Utilisateurs** (`/dashboard/admin/users`) pour attribuer des rôles aux comptes suivants.

## Déploiement

### Backend (Render)
1. Créer un Web Service sur [render.com](https://render.com)
2. Build command : `npm install && npm run build`
3. Start command : `npm run start:prod`
4. Configurer les variables d'environnement (mêmes clés qu'en local, avec les vraies valeurs de production)

### Frontend (Netlify / Vercel)
1. Build command : `npm run build`
2. Publish directory : `dist`
3. Configurer `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` avec les valeurs de production

## Rôles & Permissions

| Rôle | Accès |
|------|-------|
| `super_admin` | Tout — gestion des rôles, règles de commission, réinitialisation de session |
| `admin` | Tableau de bord plateforme, approbation commerçants, gestion utilisateurs, réinitialisation de session |
| `enterprise` | Tableau de bord Entreprise (récapitulatif, meilleures boutiques, transactions récentes, dépenses), création/gestion de plusieurs boutiques, numéro ScanLinkPay pour être payé directement |
| `merchant` | Demandes de paiement, transactions, règlements, gestion d'équipe (inviter un caissier) |
| `cashier` | Demandes de paiement, transactions (rattaché à un marchand, ne gère pas l'équipe ni les règlements) |
| `client` | Paiements, historique, reçus — accessible à tous les rôles, pas seulement `client` |

## Flow de paiement

Deux façons d'initier un paiement :
- **Facture précise** : le commerçant crée une demande de paiement avec un montant fixe → lien + QR générés (`/p/:token`), expire après un délai.
- **Numéro ScanLinkPay** : chaque entreprise a un numéro fixe et non expirant (`/pay/:numéro`) — le client scanne le QR permanent ou tape le numéro, choisit lui-même le montant et la boutique (si plusieurs), sans qu'une facture n'ait été créée à l'avance.

Les deux convergent ensuite sur le même parcours :
1. Client ouvre le lien / scanne le QR (aucun compte requis)
2. Choix du mode (Mobile Money + opérateur, carte, ou solde LinkPay si connecté), saisie des infos
3. PSP traite la transaction (`mock` : succès simulé après un court délai ; `cinetpay` : vraie redirection Mobile Money/carte)
4. Transaction enregistrée, commission calculée, grand livre mis à jour
5. Notification instantanée (temps réel) au commerçant et au client
6. Reçu disponible, commerçant peut demander un règlement
7. Un admin traite le règlement (`/dashboard/admin/settlements`)

## Sécurité

- **Session unique par appareil** : une connexion sur un deuxième appareil est refusée tant que le premier ne s'est pas déconnecté explicitement ou qu'un admin n'a pas réinitialisé la session (`/dashboard/admin/users`).
- **RLS Supabase** activé sur toutes les tables, appliqué en plus des vérifications de rôle côté API.
- Les commerçants et caissiers n'ont accès qu'aux données de leur propre boutique ; un caissier ne peut ni demander de règlement ni gérer l'équipe.

## Licence

© 2024 LinkPay. Tous droits réservés.
