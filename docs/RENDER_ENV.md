# Variables d'environnement à mettre sur Render

Où : **Render → service → Environment → Add Environment Variable**. Après un enregistrement, Render redéploie le service.
Les valeurs secrètes (tokens, mots de passe, clés) ne vont **jamais** dans le dépôt, dans un message ou dans une capture : seulement dans Render.

Deux services : **`linkpay-api`** (l'API) et **`linkpay-web`** (le site). Une variable `VITE_…` du site n'est lue qu'à la **construction** : après l'avoir changée, lancer un nouveau déploiement (Manual Deploy → Clear build cache & deploy).

---

## 1. FlexPaie (paiements : Mobile Money et carte bancaire) — service `linkpay-api`

À faire dans cet ordre. Le détail est dans `docs/FLEXPAIE.md`.

| Variable | Valeur | Remarque |
|---|---|---|
| `FLEXPAIE_MOMO_URL` | l'adresse « Momo » de l'e-mail de FlexPaie, **en entier** | se termine par `/paymentService` |
| `FLEXPAIE_CARD_URL` | l'adresse « Carte » de l'e-mail, **en entier** | se termine par `/paymentService` |
| `FLEXPAIE_CHECK_URL` | `https://apicheck.flexpaie.com/api/rest/v1/check` | la fin `/ORDER_NUMBER_A_REMPLACER` de l'e-mail est tolérée |
| `FLEXPAIE_MERCHANT` | le code marchand de **production** | `CONGOCONSULTINGENT_67B4` |
| `FLEXPAIE_TOKEN` | le token Bearer de l'e-mail | avec ou sans le mot `Bearer` devant |
| `PSP_PROVIDER` | `flexpaie` | **en dernier**, seulement après un petit paiement de test réussi |

`CARD_PAYMENTS_ENABLED` = `true` (**optionnelle**) : ouvre le paiement par **carte bancaire** pour les recharges. Fermée par défaut (le choix « Carte bancaire » reste grisé avec « Bientôt »). À ne mettre qu'après un vrai test par carte (voir `docs/FLEXPAIE.md`, section « Carte bancaire »).

Ne pas créer `FLEXPAIE_BASE_URL` : elle ne sert que s'il n'y a **qu'une seule** adresse pour tout (documentation de test) ; avec les trois adresses ci-dessus elle est inutile.

`PROXY_URL` (optionnelle) : seulement si FlexPaie refuse les appels parce que l'adresse IP de Render n'est pas autorisée (erreur de connexion, délai dépassé ou `403`). Valeur : l'adresse du proxy à IP fixe (`http://utilisateur:motdepasse@hôte:port`).

Avant `PSP_PROVIDER=flexpaie` :
1. Supabase → SQL Editor : exécuter `linkpay-api/supabase/migrations/060_flexpaie_orders.sql` (choisir « Run and enable RLS »).
2. Faire un petit paiement Mobile Money (quelques centaines de FC) et vérifier que le solde est crédité.

Tant que `PSP_PROVIDER` n'est pas `flexpaie`, le code FlexPaie est inactif et ne change rien.

---

## 2. Variables déjà prévues dans `render.yaml` — service `linkpay-api`

Elles sont déclarées avec `sync: false` : Render demande leur valeur au premier déploiement.

| Variable | Rôle |
|---|---|
| `FRONTEND_URL`, `BACKEND_URL` | adresses publiques du site et de l'API |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | base de données (la clé `service_role` est **secrète**) |
| `JWT_SECRET` | signature des sessions (longue et aléatoire, secrète) |
| `TWO_FACTOR_ENCRYPTION_KEY` | chiffrement des secrets de double authentification (administrateurs) |
| `APP_CODE_PEPPER` | renforce la protection des codes d'accès |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAILS` | e-mails d'alerte |
| `SMS_PROVIDER` + `AT_*` ou `TWILIO_*`, `ALERT_SMS_TO` | SMS d'alerte critique |
| `REDIS_URL` | compteurs partagés (rempli tout seul depuis `linkpay-redis`) |
| `COOKIE_AUTH`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` | sessions en cookies (voir `docs/COOKIES_HTTPONLY.md`) |
| `DEVICE_INTEGRITY_MODE`, `ANDROID_*`, `PLAY_INTEGRITY_*`, `INTEGRITY_*` | contrôle de l'appareil Android (voir `docs/ANDROID_INTEGRITY.md`) |
| `ADMIN_ALLOWED_IPS` | adresses IP autorisées pour l'administration (optionnel) |
| `VAPID_*`, `FCM_*` | notifications push |
| `CINETPAY_API_KEY_CD`, `CINETPAY_API_PASSWORD_CD` | ancien prestataire (inutile si FlexPaie est choisi) |

Déjà fixées dans le fichier (pas besoin d'y toucher) : `NODE_ENV=production`, `PORT=3000`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `ENABLE_SWAGGER=false`, `ADMIN_REFRESH_EXPIRES_IN`.

---

## 3. Site — service `linkpay-web`

| Variable | Rôle |
|---|---|
| `VITE_API_URL` | adresse de l'API (`https://…/api/v1`, ou `/api/v1` avec les cookies) |
| `VITE_PUBLIC_WEB_URL` | adresse publique du site |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | base de données (clé publique `anon` uniquement) |
| `VITE_VAPID_PUBLIC_KEY` | notifications push (clé publique) |
| `VITE_AUTH_COOKIES` | `true` avec les cookies (voir `docs/COOKIES_HTTPONLY.md`) |
| `VITE_PLAY_CLOUD_PROJECT_NUMBER` | application Android uniquement |

Aucune variable FlexPaie sur le site : tout passe par l'API.

---

## 4. Après le déploiement

- `linkpay-api` : ouvrir `/health` pour vérifier qu'il répond.
- Ne jamais mettre de clé secrète dans une variable `VITE_…` : tout ce qui commence par `VITE_` est visible par les visiteurs du site.
- Un secret publié par erreur (message, capture, dépôt) est à **remplacer** chez son fournisseur, pas seulement à masquer.
