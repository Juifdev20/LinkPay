# LinkPay — Paiements par lien et QR code en RDC

Plateforme de paiement PWA (mobile-first) permettant aux commerçants de créer des demandes de paiement instantanées via lien et QR code, avec règlements, remboursements, gestion d'équipe, temps réel et administration multi-rôles.

## Architecture

```
LinkPay/
├── linkpay-api/              # Backend NestJS (API REST)
│   ├── src/
│   │   ├── auth/              # JWT (login, register, refresh, logout), session unique par appareil
│   │   ├── users/              # Profil utilisateur, stats client
│   │   ├── merchants/          # Boutiques, équipe (inviter/retirer un caissier)
│   │   ├── organizations/      # Comptes "entreprise" (profil de base)
│   │   ├── payment-requests/   # Demandes de paiement (lien + QR)
│   │   ├── payments/           # Paiement + adaptateurs PSP (mock, CinetPay)
│   │   ├── transactions/       # Historique et reçus
│   │   ├── settlements/        # Règlements commerçants (solde, demande, traitement admin)
│   │   ├── refunds/            # Remboursements
│   │   ├── commissions/        # Règles de commission (admin)
│   │   ├── ledger/              # Grand livre (double entrée)
│   │   ├── notifications/      # Notifications utilisateur (API + temps réel)
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
    │   │   ├── auth/               # Login, Register (choix client/marchand)
    │   │   ├── public/             # PaymentLink (paiement anonyme), PaymentResult
    │   │   ├── merchant/           # Dashboard, PaymentRequests, Create, Transactions, Settlements, Team
    │   │   ├── client/             # Dashboard, Transactions
    │   │   ├── admin/              # Dashboard, Merchants, Users, Settlements, Commissions
    │   │   ├── OrganizationProfile.tsx
    │   │   └── Settings.tsx        # Profil, upgrade marchand/entreprise, gestion
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

Variables d'environnement (`linkpay-api/.env`) :
```
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_ANON_KEY=votre-clé-anon
SUPABASE_SERVICE_ROLE_KEY=votre-clé-service-role

JWT_SECRET=une-chaîne-secrète-longue
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=365d

# PSP — laisser "mock" pour développer sans compte prestataire réel
PSP_PROVIDER=mock
# Si compte CinetPay actif (Mobile Money RDC) :
# PSP_PROVIDER=cinetpay
# CINETPAY_API_KEY=
# CINETPAY_SITE_ID=
# PSP_WEBHOOK_SECRET=   # clé secrète HMAC de notification CinetPay
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
```

L'application démarre sur `http://localhost:5173`.

### 4. Premiers comptes

Aucun compte n'est pré-créé. Inscrivez-vous depuis `/register` (choix Client ou Marchand). Pour obtenir un compte `admin`/`super_admin`/`cashier`/`enterprise`, il faut soit :
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
| `enterprise` | Profil d'organisation (gestion multi-boutiques non encore disponible) |
| `merchant` | Demandes de paiement, transactions, règlements, gestion d'équipe (inviter un caissier) |
| `cashier` | Demandes de paiement, transactions (rattaché à un marchand, ne gère pas l'équipe ni les règlements) |
| `client` | Paiements, historique, reçus — accessible à tous les rôles, pas seulement `client` |

## Flow de paiement

1. Commerçant crée une demande de paiement → lien + QR générés
2. Client ouvre le lien / scanne le QR (aucun compte requis)
3. Choix du mode (Mobile Money + opérateur, ou carte), saisie des infos
4. PSP traite la transaction (`mock` : succès simulé après un court délai ; `cinetpay` : vraie redirection Mobile Money/carte)
5. Transaction enregistrée, commission calculée, grand livre mis à jour
6. Notification instantanée (temps réel) au commerçant et au client
7. Reçu disponible, commerçant peut demander un règlement
8. Un admin traite le règlement (`/dashboard/admin/settlements`)

## Sécurité

- **Session unique par appareil** : une connexion sur un deuxième appareil est refusée tant que le premier ne s'est pas déconnecté explicitement ou qu'un admin n'a pas réinitialisé la session (`/dashboard/admin/users`).
- **RLS Supabase** activé sur toutes les tables, appliqué en plus des vérifications de rôle côté API.
- Les commerçants et caissiers n'ont accès qu'aux données de leur propre boutique ; un caissier ne peut ni demander de règlement ni gérer l'équipe.

## Licence

© 2024 LinkPay. Tous droits réservés.
