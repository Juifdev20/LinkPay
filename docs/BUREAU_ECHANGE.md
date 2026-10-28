# Bureau d'échange (CDF ↔ USD)

Un client, un marchand ou un patron change ses francs en dollars, ou l'inverse, **dans son portefeuille**, aux prix que le
super admin fixe. ScanLinkPay gagne l'écart entre son prix d'achat et son prix de vente du dollar. Migration `088`,
module API `src/exchange/`, écran `pages/wallet/Exchange.tsx`, page admin `pages/admin/Exchange.tsx`.

> ## ⚠️ Point légal à régler AVANT d'ouvrir le service au public
> Changer des devises contre une marge est **encadré par la Banque Centrale du Congo (BCC)** : il faut en principe être une
> banque, un établissement de paiement ou un bureau de change **agréé**, ou passer par un partenaire agréé. Même
> remarque que pour les portefeuilles (migration `006`). Le code construit l'architecture ; il ne rend pas la plateforme
> conforme. **Le service est livré FERMÉ** (`exchange_settings.enabled = false`) : personne ne voit le moindre bouton tant que le
> super admin ne l'ouvre pas. À faire valider par un juriste ou la BCC avant l'ouverture publique.

## Comment ça marche

- **Deux prix**, comme un vrai bureau de change (page admin « Argent → Bureau d'échange ») :
  - *prix d'achat* = francs donnés au client pour 1 $US, quand il **donne des dollars** ;
  - *prix de vente* = francs payés par le client pour 1 $US, quand il **donne des francs**.
  
  Le prix d'achat ne dépasse jamais le prix de vente ; l'écart est le gain. Le *taux du marché* (facultatif) sert à
  mesurer ce gain par échange (« gain par rapport au marché ») ; vide, c'est le milieu des deux prix. L'aide « Remplir les
  deux taux » calcule achat = marché − marge et vente = marché + marge.
- **Aucun autre frais** : le client voit un seul taux.
- **Offre garantie 60 s.** Au toucher de « Continuer », le serveur fige le taux (`exchange_quotes`, usage unique). Le client
  confirme avec son **PIN** (le même écran que les retraits). Offre expirée → un nouveau taux est proposé, et signalé
  si le prix a bougé. Jamais appliqué « en retard ».
- **Arrondis toujours à la baisse** pour le client : francs entiers (USD → CDF), centimes de dollar (CDF → USD).
  Le même calcul existe en SQL (`exchange_compute`), côté API (`computeExchange`) et dans l'application
  (`lib/exchange.ts`) : vérifié identique sur des milliers de cas aléatoires.
- **Atomique** : `execute_exchange()` débite une devise, crédite l'autre et enregistre l'échange dans **une transaction**,
  après avoir revérifié les limites **sous le verrou du portefeuille** (deux échanges simultanés ne passent pas tous
  deux sous un plafond). Idempotent (clé d'idempotence) : une requête rejouée renvoie le même échange.
- **Qui ?** Clients, marchands, patrons (`enterprise`). Jamais les employés (caissier, gérant, magasinier, vendeur,
  comptable) ni l'équipe. Il faut en plus un **compte validé** (voir plus bas). Un employé n'a ni le bouton ni la page, et
  l'application n'interroge même pas le service.
- **Pause automatique** : si les taux ne sont pas mis à jour depuis plus de **24 h**, le service se met en pause tout seul
  (aucun échange, message clair), pour qu'un taux périmé ne coûte pas d'argent.
- **Garde-fous des taux** : une faute de frappe (taux à plus de 20 % de l'ancien, écart achat/vente > 15 %) demande une
  seconde confirmation ; changer les taux, ouvrir/fermer le service et changer les limites demandent le **code
  d'authentification** (étape supplémentaire déjà utilisée pour les frais et limites). Chaque changement est journalisé
  (`audit_logs`, historique des taux) et alerte les super admins.

## Mise en service (dans cet ordre)

1. Exécuter `linkpay-api/supabase/migrations/088_exchange_bureau.sql` (après 087), sur la base de test d'abord.
   (`base_test.sql` a été régénéré : `node supabase/construire-base-test.js`.)
2. Déployer l'API et l'application.
3. Page admin « Bureau d'échange » : saisir les **taux du jour**, régler les **limites** (voir plus bas), puis **ouvrir le
   service** (le bouton refuse tant que les taux ne sont pas à jour).
4. Valider les premiers comptes (« Comptes à valider »).
5. Mettre à jour les taux **au moins une fois par jour**.

## Validation des comptes (version 1 : à la main)

Il n'existait pas de « compte vérifié » pour les particuliers (seuls les marchands ont un KYC, les entreprises un KYB).
Version 1 : le client touche « Bureau d'échange » → message « Validation de votre compte requise » avec le bouton
**« Envoyer ma demande de validation »** déjà prêt (un seul toucher, aucun formulaire). La demande part avec le nom et le
numéro du compte ; l'équipe reçoit une alerte, **contacte la personne et vérifie son identité hors de l'application**,
puis « Valider » ou « Refuser » (motif obligatoire, montré au client). Le client est prévenu par notification. Un refus
peut être renouvelé 24 h plus tard. « Retirer » enlève l'accès à un compte validé.
Version suivante (pas faite) : envoi de la photo de la pièce d'identité dans l'application.

## Limites

Par devise **donnée** : minimum, maximum par échange, par jour, par mois (par portefeuille ; « le jour » = jour de
Kinshasa). Vide = pas de limite. **Livrées avec un minimum seulement** (1 $ / 3 000 FC) : les plafonds sont à décider avec
l'équipe, avant l'ouverture, dans la page admin.

## Trésorerie et risque de change — à comprendre avant d'ouvrir

Les soldes des clients sont des écritures du grand livre ; l'argent réel est sur le compte FlexPaie de ScanLinkPay. Un
échange ne bouge pas l'argent réel : il change **ce que ScanLinkPay doit** à ce client dans chaque devise. Si les clients
changent surtout des dollars en francs, ScanLinkPay doit davantage de francs et moins de dollars : la page
**Trésorerie** (« disponible = solde FlexPaie − dû aux clients », par devise) le montre, **et peut devenir négative en
francs**. Il faut alors convertir de vrais dollars en francs (auprès d'un bureau de change ou d'une banque) pour garder la
liquidité dans les deux devises. Les gains des échanges (en francs, mesurés contre le taux du marché, argent de test
exclu) apparaissent dans « Recettes de ScanLinkPay depuis le début » (ligne « Bureau d'échange »). **Si le marché bouge et que les taux ne suivent pas, des clients
peuvent profiter de l'écart** : d'où la mise à jour quotidienne, les limites et la pause à 24 h.

## Ce que voit l'utilisateur

- Accueil : un bouton « Bureau d'échange » **hors de la carte**, au-dessus de « Mes dépenses » (même composant : la carte et
  ses quatre boutons ne changent pas). Aussi dans « Plus » (téléphone) et le menu de gauche (ordinateur), et sur le
  portefeuille de l'entreprise pour le patron. Rien tant que le service est fermé.
- Écran : « Je donne » / « Je reçois » (flèche pour inverser), champ de montant (clavier numérique du téléphone ;
  centimes pour les dollars), aperçu du montant reçu, taux du jour, limite restante, puis confirmation (taux garanti,
  compte à rebours), PIN, et écran de réussite (référence, taux, nouveaux soldes).
- Au retrait ou à l'envoi, si le solde d'une devise ne suffit pas mais que l'autre le permet : « Il vous manque 68 000 CDF —
  vous avez 250,00 $US : changez-en une partie », qui ouvre l'échange avec le montant à donner déjà rempli. Jamais proposé à
  un compte non validé ni quand le service est fermé.
- L'historique du portefeuille montre « Échange de devises » (« Contre 282 000 CDF » / « Depuis 100 $US »). Un échange
  n'est pas une dépense : « Mes dépenses » ne le compte pas.

## Tests

- SQL (base locale complète 001 → 088) : montants, arrondis, refus (service coupé, compte non validé, taux périmés, offre
  expirée/utilisée, clé réutilisée, solde, minimum, limite du jour), rejeu idempotent, et **deux échanges simultanés sous
  une limite : un seul passe**.
- API : `src/exchange/*.spec.ts` (règles de calcul, rôles, messages, service, accès HTTP et validation).
- Application : parcours complet, refus, taux expiré, comptes non validés, employés, pause, administration — joués sur les
  vrais écrans (téléphone 390 px et ordinateur 1280 px) avec une fausse API.
