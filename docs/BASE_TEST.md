# Base de test « LinkPay Test » (développeurs)

Deux projets Supabase, chacun marqué pour toujours (migration `071`, table `platform_environment`) :

| | **LinkPay** (production) | **LinkPay Test** |
|---|---|---|
| Qui | les vrais clients | les développeurs |
| Argent | réel uniquement (FlexPaie) | **argent de test** uniquement |
| `credit_test_money` | **refusé** | autorisé |
| Paiements FlexPaie (recharge, carte, retrait, abonnement par Mobile Money) | oui | **refusés par l'API** (aucun argent réel ne peut arriver dans la base de test) |
| Transferts, paiement d'un marchand par le solde, caisse, tontine, épargne | oui | oui, avec l'argent de test |

Un environnement ne peut pas changer : la production ne peut jamais devenir « test » pour fabriquer de l'argent.

## 1. Créer le projet (une seule fois)
1. supabase.com → **New project** → nom `LinkPay Test`, région **Frankfurt** (comme Render), un mot de passe de base solide
   (à garder dans le gestionnaire de mots de passe, jamais dans un message).
2. Attendre que le projet soit prêt.

## 2. Construire la base (une seule fois)
1. Ouvrir `linkpay-api/supabase/base_test.sql` (sur GitHub : bouton **Raw**, tout sélectionner, copier).
2. Projet **LinkPay Test** → **SQL Editor** → New query → coller → **Run**.
3. Le résultat doit afficher une seule ligne : `environnement = test`.

⚠️ **Jamais dans le projet de production** : ce fichier marque la base comme « test » pour toujours.

Le fichier contient toutes les migrations (`001` à la dernière). Il a été vérifié sur une base vide, envoyé d'un seul bloc
comme le fait l'éditeur Supabase.

## 3. Brancher l'API et le site sur la base de test (sur le PC du développeur)
Projet LinkPay Test → **Project Settings → API** : l'URL, la clé `anon` et la clé `service_role`.

`linkpay-api/.env` (copie de `.env.example`) :
```
SUPABASE_URL=<URL du projet LinkPay Test>
SUPABASE_ANON_KEY=<clé anon de LinkPay Test>
SUPABASE_SERVICE_ROLE_KEY=<clé service_role de LinkPay Test>
JWT_SECRET=<une longue chaîne au hasard, différente de la production>
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000
```
Ne pas mettre les variables `FLEXPAIE_*` de production : de toute façon, sur la base de test, l'API refuse tout paiement
réel (au démarrage, elle écrit `Database: test — real payments are refused, test money only`).

`linkpay-web/.env.local` :
```
VITE_API_URL=http://localhost:3000/api/v1
VITE_SUPABASE_URL=<URL du projet LinkPay Test>
VITE_SUPABASE_ANON_KEY=<clé anon de LinkPay Test>
```
Puis `npm run start:dev` dans `linkpay-api` et `npm run dev` dans `linkpay-web`.

La clé `service_role` ouvre toute la base : uniquement dans le fichier `.env` local (jamais dans Git, jamais dans un message).

## 4. Le premier administrateur
S'inscrire dans l'application (avec son numéro), puis dans le SQL Editor de **LinkPay Test** :
```sql
INSERT INTO user_roles (user_id, role_id)
SELECT p.id, r.id FROM profiles p, roles r
 WHERE regexp_replace(p.phone, '\D', '', 'g') = '243810000001' AND r.slug = 'super_admin'
ON CONFLICT DO NOTHING;
```
Les rôles suivants s'attribuent depuis l'application (Administration → Utilisateurs).

## 5. L'argent de test
Voir `docs/RECHARGE_TEST.md` :
```sql
SELECT credit_test_money('0810000001', 50000, 'CDF');
SELECT remove_test_money('0810000001', 'CDF');
```

## 6. Une nouvelle migration
1. L'écrire dans `linkpay-api/supabase/migrations/` (numéro suivant).
2. L'exécuter **d'abord sur LinkPay Test** (SQL Editor), vérifier l'application.
3. Puis sur la production, au moment du déploiement.
4. Régénérer le fichier de construction : `node supabase/construire-base-test.js` (dans `linkpay-api`), et le commiter.

## Ce qui ne se teste QUE en production
FlexPaie n'a pas de bac à sable : la recharge Mobile Money / carte et le retrait se vérifient sur la production, avec un
vrai compte (jamais un portefeuille de test) et de petits montants réels (100 CDF). Voir `docs/FLEXPAIE.md`,
« Mise en service ».
