# Hors ligne — marche à suivre pour toute nouvelle fonctionnalité

Le hors ligne est le point fort de ScanLinkPay : un supermarché ou une boutique d'électronique vend même quand le réseau
tombe, et tout est envoyé au retour du réseau. Ce document dit comment garder cette promesse quand on ajoute une
fonctionnalité. Les raisons de fond : `DECISIONS.md` (« Mode hors ligne », 22/10, et « Audit du hors ligne », 28/10).

## La question à se poser, dans l'ordre
1. **Cela déplace-t-il de l'argent ScanLinkPay** (envoi, recharge, retrait, paiement par portefeuille ou carte, échange de
   devises) ? Alors **en ligne**, toujours : seul le serveur connaît le vrai solde, et hors ligne on pourrait dépenser deux
   fois la même somme. Voir « Rester en ligne » ci-dessous.
2. **Un commerçant en a-t-il besoin au comptoir, pendant une coupure** (vendre en espèces, entrer ou sortir du stock, compter
   un inventaire, noter une dépense, mouvement d'espèces du tiroir) ? Alors **hors ligne** : voir « Rendre une action hors ligne ».
3. Sinon (réglages, création de comptes, administration) : **en ligne**, et on le déclare.

## Rendre une action hors ligne (4 gestes)
1. **Serveur** : l'action accepte un `client_ref` (identifiant créé sur l'appareil) et l'applique **une seule fois** — index
   unique + `ON CONFLICT` / fonction SQL idempotente (modèles : `record_offline_pos_sale`, migrations 073 à 075). Envoyée deux
   fois, elle donne le même résultat. Si l'heure compte, accepter l'heure réelle (`sold_at`, `noted_at`) avec des bornes.
   *L'argent encaissé gagne toujours* : ce que l'appareil ne pouvait pas savoir est signalé au Journal, pas refusé.
2. **Gestionnaire** : dans `linkpay-web/src/lib/outbox-handlers.ts`, `registerOutboxHandler('mon.action', { send, invalidate })`.
   `send` renvoie `client_ref: op.id`.
3. **Écran** : `enqueue('mon.action', 'Libellé lisible', payload, détail, clientRef)` quand il n'y a pas de réseau
   (`useOnline()` / `isNetworkError`). L'écran fonctionne avec ce qu'il a déjà (le cache de lecture, 14 jours). Sur un appel
   qui peut basculer, passer `OFFLINE_FALLBACK` (n'attend que 10 s : un réseau « muet » ne bloque pas le comptoir).
4. **Déclaration** : `linkpay-web/scripts/offline-manifest.mjs` → `offline` ou `partial` (dire ce qui marche sans réseau).

L'écran **Synchronisation** (menu Plus) montre ce qui attend ou a été refusé ; un refus (4xx) n'est jamais renvoyé seul.

## Rester en ligne (et le dire)
- Mettre l'écran sous `<RequireOnline what="…" why="…">` dans `App.tsx` : il explique pourquoi (« le Bureau d'échange a besoin
  d'Internet : le taux est garanti 60 secondes par le serveur… ») au lieu d'un formulaire qui échouerait à la fin. Le bouton
  d'entrée peut afficher `hint="Internet requis"` quand il n'y a pas de réseau (modèle : `ExchangeEntry`).
- Si malgré tout un appel d'écriture échoue faute de réseau, `lib/api.ts` affiche le message général « Cette action a besoin
  d'Internet et n'a pas été envoyée » (`NeedsNetworkNotice`). Rien à faire de plus.
- Déclarer le fichier `online` dans le manifeste, avec la raison.

## Le garde-fou
`npm run check:offline` (dans `linkpay-web`, lancé avant `npm run build`, `build:android` et par la CI) liste tous les fichiers
de `src/` qui font `api.post/put/patch/delete`. Il échoue si :
- un fichier qui écrit n'est pas dans `scripts/offline-manifest.mjs` — **c'est le cas d'une nouvelle fonctionnalité** ;
- un fichier déclaré `offline` / `partial` n'utilise pas `enqueue()` (ou l'inverse : `online` mais utilise `enqueue()`) ;
- une raison manque, ou le fichier déclaré n'existe plus.
Il ne juge pas si la décision est la bonne : c'est la personne qui ajoute la fonctionnalité qui répond à la question.

## Vérifier dans un vrai navigateur
Construire le site (`vite build`), le servir, couper le serveur de l'API (ou le laisser **muet** : connexion ouverte qui ne
répond jamais, le cas du Wi-Fi sans Internet) et jouer : vendre, recharger la page sans réseau, vendre encore, rendre le réseau,
compter les écritures reçues (une seule par vente). C'est ainsi qu'a été trouvé le défaut du réseau muet.

## Limites connues (28/10/2026)
- Ouvrir / fermer la caisse, créer ou modifier un produit, mettre un ticket en attente : en ligne.
- Au-delà d'environ 8 000 produits, le catalogue dépasse la place du navigateur (localStorage, ~5 Mo) et n'est pas gardé.
- Une dépense de l'entreprise (`OrganizationProfile`) et le changement d'état d'une demande d'achat sont de bons candidats
  pour passer hors ligne ensuite.
