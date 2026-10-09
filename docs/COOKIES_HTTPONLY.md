# Session dans des cookies HttpOnly (navigateur)

## Pourquoi
Jusqu'ici le navigateur gardait les jetons de session dans `localStorage`. Une faille XSS (un script étranger qui
s'exécute dans la page) pouvait les lire et les envoyer ailleurs. Dans un cookie **HttpOnly**, le navigateur garde le jeton
et l'envoie lui-même : **aucun script de la page ne peut le lire**, même s'il s'y glisse. La CSP déjà en place rend
l'injection difficile ; les cookies HttpOnly limitent les dégâts si elle réussit malgré tout.

## Comment ça marche
- L'API (`COOKIE_AUTH=true`) met le jeton d'accès (`lp_at`, chemin `/api/v1`) et le jeton de rafraîchissement (`lp_rt`,
  chemin `/api/v1/auth` seulement) dans des cookies `HttpOnly; Secure; SameSite=Strict`, et **ne les renvoie plus dans le
  corps de la réponse**. La session Supabase « temps réel » (un second accès au même compte, lisible par un script) n'est plus
  donnée au navigateur non plus ; l'alerte « paiement reçu » et les rafraîchissements passent alors par de courtes
  interrogations (toutes les 8 à 20 secondes, application visible).
- Protection CSRF (un site tiers qui ferait agir le navigateur à votre insu) : `SameSite=Strict`, **plus** un en-tête
  `x-requested-with: ScanLinkPay` exigé pour toute écriture portée par un cookie, plus le refus des requêtes marquées
  « cross-site » par le navigateur ou venant d'une origine inconnue.
- « Se souvenir de moi » décoché : cookies de session, qui disparaissent à la fermeture du navigateur.
- Retour d'une boutique à l'organisation : `POST /auth/exit-store` (le serveur recalcule la session du patron, le navigateur
  n'a plus de jeton à échanger).
- **L'application Android et les coques natives gardent l'en-tête `Authorization`** : leur origine ne peut pas partager de
  cookie avec l'API. Rien ne change pour elles.

## Condition : même site
Un cookie `SameSite=Strict` n'est envoyé que si le site web et l'API sont sur le **même site**. Deux façons :

1. **Proxy sur le site web (celle de `render.yaml`)** : le site statique relaie `/api/*` vers l'API (règle `rewrite`). Le
   navigateur ne parle qu'à `https://<votre-site>/api/v1`. Il faut alors `VITE_API_URL=/api/v1`.
2. **Sous-domaines** : `app.scanlinkpay.com` et `api.scanlinkpay.com` avec `COOKIE_DOMAIN=.scanlinkpay.com`. (`*.onrender.com`
   ne convient **pas** : ce sont des sites différents.)

## Mise en route (dans cet ordre)
1. Vérifier dans `render.yaml` que la destination de la règle `/api/*` est bien l'adresse de votre API.
2. **Vérifier l'adresse IP vue par l'API** derrière ce relais : l'API s'en sert pour la limite de débit et pour
   `ADMIN_ALLOWED_IPS`. Après déploiement, déclencher une alerte « Connexion administrateur » : l'IP affichée doit être la
   vôtre, pas celle de Render. Sinon régler `TRUST_PROXY_HOPS` (voir `.env.example`).
3. Web : `VITE_API_URL=/api/v1` et `VITE_AUTH_COOKIES=true` (puis redéployer le site).
4. API : `COOKIE_AUTH=true` (et `COOKIE_SAMESITE=strict`, la valeur par défaut).
5. Tester : se connecter, recharger la page, attendre 15 minutes (rafraîchissement), se déconnecter. Dans les outils du
   navigateur, `localStorage` ne doit plus contenir `linkpay_access_token` ni `linkpay_refresh_token`, et les cookies `lp_at` /
   `lp_rt` doivent apparaître cochés « HttpOnly ».

Pour revenir en arrière : retirer `VITE_AUTH_COOKIES` et `COOKIE_AUTH` ; chacun doit se reconnecter.

## Limites
- Cela protège le **vol** du jeton. Un script injecté peut encore agir **pendant** que la page est ouverte (le navigateur
  joint les cookies) : c'est pourquoi la CSP, le PIN, le code d'accès et les plafonds restent indispensables.
- Les données mises en cache localement (profil, listes) restent dans `localStorage`, comme avant.
