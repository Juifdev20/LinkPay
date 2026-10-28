# Décisions — ScanLinkPay (LinkPay)

Journal des décisions non triviales, les plus récentes en haut. À lire avant de toucher aux paiements, aux retraits ou
à la base. Toute nouvelle décision importante ajoute une section ici. L'état du travail et ce qui reste : `docs/REPRISE.md`.

---

## 28/10/2026 — Bureau d'échange (CDF ↔ USD) et champ de montant commun

Demande du propriétaire : qu'un client change ses francs en dollars (et l'inverse) dans ScanLinkPay, à des taux fixés par
le super admin, avec un gain pour ScanLinkPay. Détails, mise en service et risques : **`docs/BUREAU_ECHANGE.md`**. Migration `088`.

- **Deux prix, comme un vrai bureau de change** : prix d'achat du dollar (le client donne des dollars) et prix de vente
  (il donne des francs). Le gain est l'écart, plus mesuré contre un taux du marché facultatif. Remplace l'idée première d'une
  « marge par sens » que le propriétaire a jugée incompréhensible. **Aucun autre frais** : le client voit un seul taux.
- **Livré fermé** (`exchange_settings.enabled = false`) : l'échange de devises est encadré par la BCC (même réserve que les
  portefeuilles, migration `006`). Aucun bouton n'apparaît avant l'ouverture par le super admin.
- **Qui** : clients, marchands, patrons ; **pas les employés** (décision du propriétaire). Et il faut un **compte validé** : version 1 =
  demande d'un seul toucher puis validation à la main par l'équipe (aucune photo de pièce dans l'application pour l'instant,
  elle viendra plus tard).
- **Où** : bouton « Bureau d'échange » **hors de la carte du solde**, au-dessus de « Mes dépenses » (même composant
  `ShortcutButton`). Choix du propriétaire : la carte ne doit pas grandir et ses quatre boutons restent identiques ; cinq
  boutons côte à côte ne tenaient pas (« Recharger » débordait à 360 px, mesuré sur les vrais boutons).
- **Sécurité de l'argent** : offre garantie 60 s à usage unique, PIN (même écran que les retraits), fonction SQL atomique
  avec limites revérifiées sous le verrou du portefeuille, idempotence, pause automatique si les taux ont plus de 24 h,
  confirmation supplémentaire pour un taux très éloigné du précédent, code d'authentification pour changer taux, limites et
  état du service. Pas de contrôle d'intégrité de l'appareil : l'argent ne quitte pas le portefeuille (ce contrôle est
  réservé aux envois et retraits).
- **Un échange n'est pas une dépense** : « Mes dépenses » l'ignore (`EXCHANGE_OUT`).
- **Trésorerie** : un échange déplace ce que ScanLinkPay doit dans chaque devise, pas l'argent réel : « disponible » peut
  devenir négatif en francs ; il faut alors convertir de vrais dollars. Les gains (en francs, argent de test exclu) sont
  ajoutés aux recettes de la page Trésorerie.
- **Champ de montant commun** : `AmountEntry` (grand champ de « Recharger ») devient réutilisable (centimes pour les
  dollars, devise fixée ailleurs, « Tout ») ; `AmountInput` (champ nu) remplace le `type="number"` de « Envoyer » et
  « Retirer » ; règles communes dans `lib/amount.ts`. Tous ouvrent le clavier **numérique du téléphone** ; les écrans de PIN et
  de code (clavier bleu `PinInput`) n'ont pas changé. Les autres champs de montant (caisse, stock, tontines…) ouvraient déjà
  un clavier numérique (`type="number"` ou `inputMode`) et n'ont pas été touchés.

---

## 23/10/2026 — Achats et fournisseurs, rapport par vendeur, rôles du stock, réseau de fournisseurs

Demande du propriétaire, valable pour **tous les secteurs** du module entreprise (`supermarche` et `electronique`) : rien
n'est propre à un secteur, tout passe par `stock_items`, le formulaire produit commun (`StockItemFormSheet`) et les
listes communes (`ProductTable`). Ordre de travail : A → B → C, puis le fichier Excel du modèle économique.
**Un agent qui reprend lit cette section et la case « État » de chaque phase** (mise à jour à chaque étape poussée).

### Phase A — prix d'achat, marge, fournisseur, rapport par vendeur
- **A1. Prix d'achat et marge.** La colonne `stock_items.cost_price_cents` existe depuis la migration 031 et l'API
  l'accepte déjà ; il manquait l'écran. Le formulaire produit a « Prix d'achat » (facultatif) à côté de « Prix de
  vente », dans la même devise, et affiche la marge en direct (montant et %). La liste du stock a les colonnes
  « Prix d'achat » et « Marge ». Les statistiques de marge existantes (caisse : `cost_price_cents_snapshot`,
  ventes : `unit_cost_cents`) le reprennent sans changement.
  - **Le vendeur et le caissier ne voient jamais le prix d'achat ni la marge** (`redactForRole` côté API, déjà en
    place) : l'écran n'affiche ces colonnes que si le prix d'achat est présent dans les données reçues.
  - Un produit sans prix d'achat a une marge « — » (jamais 100 %).
- **A2. Fournisseur facultatif** (migration 083). Table `suppliers` par entreprise (nom, téléphone, e-mail, adresse,
  notes ; archivage au lieu de suppression) et `stock_items.supplier_id`. Dans le formulaire : choisir dans la liste
  ou « Nouveau fournisseur… » (nom tapé → le fournisseur est créé et ajouté à la liste). Colonne « Fournisseur »
  dans la liste du stock. Masqué au vendeur et au caissier comme le prix d'achat (information d'achat).
  - La même table servira à la phase C : un fournisseur « du réseau » est une ligne avec `supplier_org_id`
    (l'entreprise fournisseur sur ScanLinkPay) ; un fournisseur tapé à la main n'en a pas.
- **A3. Rapport par vendeur sur une période choisie.** Date de début et date de fin → pour chaque vendeur/caissier :
  nombre de ventes, chiffre d'affaires par devise, marge (si prix d'achat connu). Il réunit la **caisse**
  (`pos_tickets`, supermarché) et les **Ventes** (`sales`, électronique) : un seul rapport pour tous les secteurs.

### Phase B — qui gère le stock et les achats
- Le **magasinier** voit le stock, fait l'inventaire et **demande** un réapprovisionnement. La demande va au
  **gérant** de sa station, qui l'approuve ou la refuse et passe la commande.
- **S'il n'y a pas de gérant actif dans la station, la demande remonte au patron** (décision du 23/10). Le patron
  peut toujours consulter l'historique des demandes ; il n'est plus notifié quand un gérant existe.
- Le **gérant a tous les droits du magasinier** (stock, inventaire, demandes, commandes) ; l'inverse n'est jamais
  vrai : un magasinier n'approuve rien, ne gère pas l'équipe, ne voit pas les rapports du gérant.
- À la création d'un employé, le choix du rôle explique : « Pas de magasinier ? Le gérant s'occupe du stock et des
  commandes. » et « Le magasinier gère le stock et fait des demandes au gérant. »

### Phase C — réseau de fournisseurs
- **Devenir fournisseur** (le patron l'active) : fiche (nom affiché, téléphone, adresse, zone de livraison, frais de
  livraison par défaut facultatifs), un **numéro de fournisseur** unique, un **catalogue** (produits de son stock
  qu'il accepte de vendre, avec son prix de vente aux entreprises).
- Une entreprise **invite** un fournisseur par son numéro ; le fournisseur (patron ou gérant) **accepte** ou refuse.
  Une fois acceptée, la relation ajoute ce fournisseur à la liste de A2 (`suppliers.supplier_org_id`).
- **Commande** : le client (patron, gérant) choisit un fournisseur lié, puis les produits de **son** catalogue et les
  quantités, et coche « Livraison » s'il veut être livré.
- Le fournisseur (patron ou gérant, notifiés) **confirme** la commande et fixe les **frais de livraison de cette
  commande** : les frais par défaut de sa fiche sont proposés, mais il peut les changer à chaque commande (la
  distance varie — décision du 23/10). Les frais s'ajoutent au total quand le client a demandé la livraison.
- **Paiement, deux voies (décision du 23/10)** : par portefeuille ScanLinkPay (paiement d'entreprise à entreprise,
  avec les règles de commission habituelles), ou **hors application** (espèces, Mobile Money) noté à la main par le
  fournisseur, qui confirme l'avoir reçu. Aucun argent n'est jamais créé ni déplacé hors du grand livre.
- Chaque étape produit un **ticket** (bon de commande, reçu de paiement, bon de livraison). Le fournisseur valide le
  paiement, puis la livraison ; le client confirme la **réception**.
- **À la réception, le stock du client augmente tout seul** (mouvement `restock` dans `stock_movements`, jamais une
  quantité écrite directement) et le **prix d'achat du produit devient le prix unitaire de la commande** (frais de
  livraison non inclus) : la marge du client reste juste sans rien retaper. Le produit du client est retrouvé par son
  code-barres, sinon il est créé (avec le fournisseur rempli).
- Côté fournisseur, la livraison validée sort la marchandise de son stock (mouvement `sale`).

### Phase C — le réseau de fournisseurs est payant (décision du propriétaire, 23/10)
- **Abonnement « Fournisseur » mensuel, payé par l'entreprise fournisseur.** C'est la seule recette sûre : beaucoup de
  commandes seront payées hors application (espèces, Mobile Money), où un frais par commande serait impossible à
  prélever et facile à contourner.
- **Plus la commission ScanLinkPay habituelle** sur les commandes payées par portefeuille : elles passent par une
  demande de paiement normale, rien de plus à construire.
- **L'acheteur ne paie rien de plus** : plus il y a d'acheteurs, plus les fournisseurs ont intérêt à s'abonner.
- **Tout est réglé par le super admin, depuis son interface, jamais écrit dans le code** :
  - le prix mensuel en CDF et en USD (départ proposé : 10 $ par mois, ou l'équivalent) ;
  - la durée de l'**essai gratuit** en jours (2, 3, 30… ou 0 = pas d'essai) ;
  - l'**abonnement annuel** : 12 mois pour le prix de (12 − N) mois, N (les mois offerts) fixé par le super admin.
- **L'utilisateur est prévenu** : dès qu'il ouvre « Devenir fournisseur », l'écran dit « Essai gratuit de X jours »
  (X du super admin) ; pendant l'essai, « Il vous reste X jours d'essai » ; puis le prix mensuel et annuel.
- **Sans abonnement actif** (essai fini, non payé) : le fournisseur reste visible pour ses clients, mais ne reçoit
  plus de nouvelles commandes ni de nouvelles invitations. Les commandes déjà en cours vont jusqu'au bout (on ne bloque
  jamais une livraison déjà payée).

### État
- **Phase A : faite** (23/10). Où regarder :
  - A1 : `StockItemFormSheet` (« Prix d'achat », marge en direct), `ProductTable` (`showPurchase` : colonnes Prix d'achat,
    Marge, Fournisseur), `StockItemDetailDialog`, `lib/margin.ts` (marge = vente − achat, % du prix de vente).
  - A2 : migration `083_suppliers.sql`, `stock/suppliers.service.ts` (+ routes `GET/POST/PUT/DELETE
    /organizations/:id/suppliers` dans `stock.controller.ts`), champs `supplier_id` / `supplier_name` du produit
    (`StockService.supplierOf`, nom ajouté aux listes par `withSupplierNames`, masqués au vendeur et au caissier).
    Pas encore d'écran pour renommer ou archiver un fournisseur : il viendra avec l'écran « Fournisseurs » de la phase C.
  - A3 : `reports/seller-report.service.ts`, route `GET /organizations/:id/reports/sellers?from&to&merchant_id`, page
    `pages/organization/SellerReport.tsx` (menu « Rapport des vendeurs »). Une ligne de vente électronique enregistrée
    avec un coût 0 (produit sans prix d'achat) compte comme « coût inconnu », jamais comme 100 % de marge.
  - À faire côté Supabase : migration `083` (LinkPay Test puis production). Sans elle, le formulaire marche (sans
    fournisseur) et la liste des fournisseurs répond « appliquez la migration 083 ».
- **Phase B : faite** (23/10). Où regarder :
  - API : `STOCK_STAFF_ROLES = ['magasinier', 'gerant']` (`stock.service.ts`) : le gérant crée et modifie les articles,
    fait les mouvements, essaie le mot de passe de stock et fait l'inventaire (`inventory.controller.ts`).
  - `reports/restock.service.ts` : demande du magasinier → notifiée aux gérants actifs de la station
    (`stationStaffWithRoles`), au patron seulement s'il n'y en a pas ; demande du gérant (ou du patron) validée
    d'office ; validation/refus par le gérant de la station ou le patron, jamais le magasinier ; « reçue » notifiée à
    celui qui a validé.
  - Web : page Demandes d'achat (texte par rôle, boutons Valider/Refuser pour le gérant), Inventaire ouvert au gérant,
    Stock limité à sa station, explication du rôle dans le formulaire « Nouvel utilisateur » (`Staff.tsx`, `ROLES.help`).
- **Phase C : faite** (23/10).
  - **Fait — API** (migration `084_supplier_network.sql`, dossier `linkpay-api/src/supplier-network/`) :
    - `supplier-plan.service.ts` : abonnement Fournisseur (essai fixé à l'activation, mensuel × N, annuel = 12 mois pour
      12 − N, rappels quotidiens, écran super admin `GET/PUT /admin/supplier-plan…`), paiement par
      `purchase_supplier_plan` (portefeuille du patron + PIN, idempotent ; payer pendant l'essai ajoute les mois après
      la fin de l'essai). La trésorerie (079, redéfinie dans 084) compte cette recette avec les abonnements.
    - `supplier-network.service.ts` : devenir fournisseur (numéro `F-xxxxxx`, station d'expédition), catalogue (articles
      de cette station + prix aux entreprises), invitations par numéro (accepter / refuser / mettre fin), catalogue vu
      par le client. Le fournisseur accepté entre dans la liste `suppliers` du client.
    - `supplier-orders.service.ts` : commande → confirmation avec frais de livraison de la commande → paiement
      (lien ScanLinkPay = demande de paiement ordinaire vers la station du fournisseur, marquée payée par
      `PaymentsService.markSupplierOrderPaid` via le ModuleRef ; ou espèces / Mobile Money confirmés par le
      fournisseur) → livraison (sortie de stock, idempotente par `out_ref`) → réception (entrée de stock par `in_ref`,
      produit trouvé par code-barres ou créé avec son prix de vente, prix d'achat = prix de la commande).
    - Testé : `supplier-plan.service.spec.ts`, `supplier-orders.service.spec.ts`, et la fonction SQL sur un Postgres
      local (débit unique, prolongation après l'essai, refus d'un non-propriétaire, trésorerie).
  - **Fait — écrans** (web, Android et Windows) :
    - `pages/organization/SupplierSpace.tsx` (menu « Espace fournisseur », patron et gérant) : sans fiche, l'offre avec
      « Essai gratuit de X jours » et les prix du super admin, puis le formulaire (patron) ; avec fiche, un bandeau
      (« il vous reste X jours d'essai », fin d'abonnement), l'abonnement mensuel ou annuel payé par PIN, la fiche,
      le catalogue, les clients (accepter / refuser) et les commandes reçues.
    - `pages/organization/SupplierOrders.tsx` (menu « Mes fournisseurs », patron, gérant, magasinier) : inviter par
      numéro, commander (quantités, livraison), payer par ScanLinkPay (lien `/p/:token`) ou annoncer un paiement
      espèces / Mobile Money, confirmer la réception (produit retrouvé par code-barres ou créé avec son prix de vente).
    - `components/supplier/OrderCard.tsx` (une commande vue des deux côtés, boutons de l'étape), `lib/supplier-order.ts`
      (libellés, ticket A4 de chaque étape : bon de commande, reçu de paiement, bon de livraison).
    - Super admin : carte « Abonnement Fournisseur » dans Tarifs → Abonnements (`pages/admin/SupplierPlanAdmin.tsx`).
    - Une notification annonce l'essai dès que l'entreprise devient fournisseur ; des rappels suivent avant la fin.
  - **À faire côté Supabase** : migrations `083` puis `084` (LinkPay Test puis production), puis fixer le prix CDF de
    l'abonnement Fournisseur dans l'écran super admin (seul le prix USD de 10 $ est mis par la migration).
- **Plusieurs stations par fournisseur (23/10, décision du propriétaire)** — migration `085_supplier_stations.sql` :
  - un seul espace fournisseur par entreprise, **un seul numéro et un seul abonnement pour toutes ses stations** ;
  - le patron coche les stations qui vendent (Goma, Beni…) — au moins une — et règle pour chacune sa zone et ses frais
    de livraison par défaut (`PUT /organizations/:id/supplier-stations/:merchantId`) ;
  - **un catalogue par station**, tiré de son propre stock, à ses propres prix (`supplier_catalog_items.merchant_id`) ;
    le patron passe d'un catalogue à l'autre, le gérant ne gère que celui de sa station ;
  - **le client choisit la station qui le sert** en commandant (`supplier_merchant_id`) ; la commande va au patron et
    aux gérants de cette station, sort de son stock et lui est payée. Une commande = une station (deux stations =
    deux commandes) ;
  - les invitations sont annoncées au patron et aux gérants de toutes les stations qui vendent ; le gérant de
    n'importe laquelle peut les accepter ;
  - sans la migration 085, l'API se comporte comme avant (la station unique du profil).
  - **Une nouvelle station n'est jamais cochée toute seule** : quand un fournisseur crée une station, le patron reçoit
    une notification et, sur la page Stations, la question « voulez-vous qu'elle vende aussi aux entreprises ? »
    (« Oui » la coche et ouvre son catalogue ; « Plus tard » la laisse non cochée).
- **Revue de sécurité des phases A, B, C (23/10)** — corrigé :
  - noms de fournisseurs comparés exactement (dans un motif PostgREST, `*` et `%` sont des jokers : « Bra* » aurait
    été pris pour « Bralima ») — `sameName` dans `suppliers.service.ts` ;
  - montants et quantités bornés (10 milliards par prix ou frais, 1 million d'unités par ligne) et totaux vérifiés
    entiers exacts, côté commande et confirmation ;
  - devenir fournisseur, modifier le catalogue, inviter et commander demandent l'abonnement entreprise actif ; la suite
    d'une commande en cours (paiement, livraison, réception) ne l'exige jamais ;
  - recherche d'un fournisseur par numéro limitée à 20 par minute (pas d'essai de tous les numéros) ;
  - le magasinier voit les fournisseurs de l'entreprise, pas ses clients.
  - Vérifié sans changement : chaque route contrôle l'entreprise et la station de l'appelant ; les prix d'une commande
    viennent du catalogue, jamais de la requête ; le montant de l'abonnement Fournisseur est calculé par l'API et payé
    par une fonction SQL réservée au service (propriétaire seul, son portefeuille, idempotente) ; un lien de paiement
    en cours n'est jamais fermé (annuler / refuser / paiement hors application refusés pendant un paiement) ; les
    nouvelles tables sont fermées à la clé publique (RLS, `REVOKE`).
  - **Risque accepté, à suivre** : une commande payée puis jamais livrée n'a pas de remboursement automatique ; le
    fournisseur rembourse (ou le support tranche). Un paiement espèces / Mobile Money reste déclaratif (hors
    application) : seul le fournisseur le confirme.
- **Fichier Excel du modèle économique : fait** (23/10) — `docs/modele-economique/ScanLinkPay_Modele_Economique.xlsx`,
  régénérable avec `construire_modele.py`. Tout est formule : on change une hypothèse (onglet Hypothèses, texte bleu)
  ou le scénario (Pessimiste / Réaliste / Optimiste) et tout se recalcule. Onglets : Accueil, Hypothèses (tarifs du
  code, coûts, applications partenaires de l'API dont HotelSaver), Scénarios, Prévisions (36 mois), Synthèse
  (graphiques), Dépenses (toutes les charges par an, démarrage, taxes, répartition), Prix (abonnements), Rentabilité (seuil, objectif 1 000 £, nombre d'applications API), Retraits
  (frais 1 % < coût FlexPaie 2 % : perte), Sensibilité (commission × volume).

## 22/10/2026 (après-midi) — Deux secteurs seulement ; les Ventes électronique sur le modèle de la Caisse

### 1. « Alimentation » fusionnée dans « Supermarché » (migration 076)
- Il y avait trois secteurs ; « Alimentation » passait par le module Ventes, sans caisse. Une alimentation fonctionne
  comme un supermarché : **deux secteurs** désormais :
  - `supermarche` (« Supermarché & alimentation ») : caisse, ticket thermique, rayons ;
  - `electronique` : Ventes avec IMEI, numéro de série, garantie.
- Migration `076` : les entreprises `alimentation` deviennent `supermarche`, et leurs vendeurs deviennent caissiers
  (le nouveau rôle s'applique à la prochaine connexion).
- L'API ramène `alimentation` à `supermarche` (anciennes applications) et refuse tout autre secteur inconnu.
- Le site lit encore `alimentation` comme un supermarché (`lib/sectors.ts`) tant que la migration n'est pas passée.

### 2. Ventes (électronique) : même écran, même ticket que la Caisse
- **Catalogue** : le tableau de la caisse (`ProductTable`), sans photo, avec recherche par nom, marque, modèle, IMEI ou
  code-barres. Lecteur USB et caméra.
- **Vente** : panneau « Nouvelle vente » à droite (barre panier + feuille sur téléphone).
- **Encaisser** : la même feuille que la caisse (espèces remises, appoint, monnaie, ou QR ScanLinkPay), et
  « Annuler la vente » si le client part (nouvelle route `POST /organizations/:id/sales/:saleId/cancel`).
- **Ticket** : le ticket thermique de la caisse (`buildSaleReceipt`, même imprimante), avec IMEI et garantie sous chaque
  article. La **facture A4** reste à un clic (« Facture A4 (garantie) »), aussi depuis « Toutes les ventes ».
- Les photos de produits sont retirées partout de l'affichage (place en base, inutile pour le vendeur).

### 3. Failles corrigées (module Ventes)
- **Double paiement** : « Encaissé en espèces » pendant que le client confirmait par ScanLinkPay → le client payait deux
  fois. Désormais le QR est fermé **d'abord**, et seulement si personne n'est en train de le payer ; sinon les espèces
  sont refusées.
- **Patron avec plusieurs stations** : il voyait le stock de toutes ses stations mais ne pouvait vendre que celui de la
  première (erreur « n'appartient pas à cette entreprise »). La vente appartient maintenant à la station qui détient les
  articles. Une vente = une station.
- **Dernier article vendu deux fois** (deux ventes en attente) : les espèces sont refusées si l'article n'est plus en
  stock. Un paiement ScanLinkPay déjà fait ne casse plus sur le stock : rien sous zéro, et l'écart est journalisé pour
  l'inventaire, comme pour les ventes hors ligne.

### 4. Menu rangé par fonction (ordinateur et téléphone)
- Une seule liste (`lib/nav-items.ts`) groupée en sections : **Vendre** (juste après le tableau de bord),
  **Suivi**, **Stock**, **Entreprise**, **Mon compte**, **Administration**, puis Notifications et Paramètres en bas.
  La barre latérale (ordinateur) et la page « Plus » (téléphone) utilisent les mêmes sections.
- **Synchronisation** est dans Paramètres ; elle n'apparaît dans le menu, avec un compteur, que si des opérations
  faites hors ligne attendent.
- Électronique : la Caisse et « Mes ventes » (tickets de caisse) sont masquées. Le caissier d'une boutique
  électronique arrive sur le tableau de bord des ventes, et l'onglet central du patron ouvre Ventes, plus la Caisse.

### 5. Un seul rôle de vente : « Vendeur / caissier » (migration 077)
- Dans nos boutiques, la même personne vend et encaisse. Il n'y a plus deux rôles : un seul, **Vendeur / caissier**
  (slug `caissier`, celui que connaissent déjà la caisse, le tiroir-caisse et les Ventes), dans les deux secteurs.
  - Supermarché : il vend à la caisse.
  - Électronique : il vend dans Ventes, et il a aussi le tableau de bord des ventes.
- Migration `077` : les vendeurs existants deviennent vendeurs / caissiers, sur la même station (à leur prochaine
  connexion).
- L'API transforme encore « vendeur » en « caissier » si une ancienne application l'envoie.
- Le stock ne bouge **qu'au paiement**, dans les deux secteurs : à l'encaissement du ticket de caisse, au paiement
  (espèces ou ScanLinkPay) d'une vente électronique, et pour une vente hors ligne quand elle est encaissée.

### 7. Paiement ScanLinkPay d'une vente électronique : trois failles corrigées
- **Payée par Mobile Money / carte via le QR, la vente restait « en attente »** : seul le paiement par solde ScanLinkPay
  la marquait payée. Le stock ne bougeait pas, les espèces étaient refusées et le vendeur ne voyait rien.
  - Tout paiement réussi du QR marque maintenant la vente payée (`handleSuccessfulPayment`).
  - En filet de sécurité, une vente dont le QR est payé est réglée dès que l'écran la relit. (La caisse du supermarché
    lisait déjà l'état du QR : elle n'avait pas ce problème.)
- **La page de paiement marquait « EXPIRED » un QR déjà payé** (ou en cours de paiement) quand on l'ouvrait après sa
  date. Elle ne marque plus que ceux que personne ne paie (`CREATED`). L'expiration et l'annulation des ventes
  acceptent aussi un QR marqué « EXPIRED » ; sans cela, la vente ne passait jamais en « Annulée ».
- **Fenêtre d'encaissement fermée pendant que le client paie** : la vente reste dans un bandeau au-dessus du catalogue,
  avec « Reprendre ». Si le client paie entre-temps, le bandeau passe au vert, avec « Voir le ticket ».

### 8. Audit de toute l'application : trois familles de failles cherchées
1. **Un paiement réussi par un chemin, mais l'objet lié n'écoute qu'un autre chemin.**
   - Caisse et cartes : elles lisent l'état du QR, donc correctes quel que soit le moyen de paiement.
   - Les confirmations de l'opérateur, la vérification d'état et la tâche de rattrapage passent toutes par la même
     fonction pour les paiements marchands, et par leur propre traitement pour les recharges, Pro et transferts.
   - Abonnements : une seule opération atomique en base.
   - Seule faille trouvée : les Ventes (corrigé, § 7).
2. **États finaux écrasés** (passages sans condition sur l'état actuel, relevés par un script sur toute l'API) :
   - « EXPIRED » sur un QR payé (corrigé, § 7) ;
   - mode Pro des dépenses prolongé deux fois quand l'opérateur et la vérification confirment en même temps :
     maintenant réservé d'abord, puis prolongé une seule fois ;
   - tontine payée remise « en retard » par la tâche du jour (module désactivé, corrigé quand même).
3. **Deux façons de payer la même chose en même temps** :
   - **Caisse supermarché** : « Retirer le ScanLinkPay en attente » laissait le QR payable 30 minutes ; le client
     pouvait payer le QR puis donner des espèces (payer deux fois). Le QR est maintenant fermé d'abord, et le retrait
     refusé si le client est en train de le payer.
   - Ventes : corrigé (§ 3).
   - Cartes, paiement par portefeuille, espèces en double à la caisse, ventes hors ligne : déjà protégés.

### 9. Inviter un caissier (petite boutique) : par téléphone ou email, et la personne accepte (migration 078)
- **Avant** : le marchand ajoutait un caissier par email, et le compte de la personne devenait caissier tout de suite,
  sans son accord ni même une notification. Par téléphone (numéro facile à connaître), n'importe qui aurait pu
  transformer le compte de n'importe qui.
- **Maintenant** : le marchand envoie une **invitation** (numéro dans tous les formats, ou email). La personne reçoit une
  notification et un bandeau sur son accueil : **Accepter** / **Refuser**. Rien ne change sur son compte avant
  « Accepter ». À l'acceptation :
  - elle rejoint l'équipe et son rôle devient caissier ;
  - un nouveau jeton arrive, l'application bascule sans nouvelle connexion ;
  - le marchand est prévenu.
- Une invitation par personne et par boutique à la fois. Elle expire après 7 jours, et le marchand peut l'annuler.
- Les règles sont revérifiées à l'acceptation : seul un compte client, dans aucune équipe, peut devenir caissier.
- Le marchand ne voit que le prénom et l'initiale (« Grace K. ») et la fin du numéro : on ne révèle pas l'identité
  derrière un numéro.
- L'ajout direct (`addMerchantUser`) est supprimé. Une ancienne application qui l'appelle crée désormais une invitation.
- Ne concerne pas les entreprises : elles créent leurs employés elles-mêmes (Utilisateurs internes).

### 10. Trésorerie (super admin) : ce qui peut sortir de FlexPaie sans risque (migration 079)
- L'argent réel est sur le compte marchand FlexPaie. Les soldes ScanLinkPay sont une dette envers leurs titulaires.
  Un abonnement, une commission ou un frais ne déplace pas d'argent chez FlexPaie : il fait passer une part de cet
  argent des utilisateurs à ScanLinkPay.
- Page **Trésorerie** (super admin) :
  - **dû aux utilisateurs** = soldes positifs + épargne + retraits débités pas encore envoyés + paiements reçus pas
    encore crédités aux marchands ; les portefeuilles de test sont exclus ;
  - **retirable sans risque** = solde FlexPaie − dû aux utilisateurs. Le solde FlexPaie est relevé dans le tableau de
    bord FlexPaie et saisi à la main, avec code d'authentification et journal. Aucune API FlexPaie n'est utilisée.
  - Rien n'est affiché comme retirable tant que le solde n'a pas été saisi. Un montant négatif est montré en rouge
    (« ne retirez rien »).
- Recettes depuis le début, pour information : abonnements, commissions, frais de retrait et de transfert, mode Pro.
- L'ancien argent fictif d'avant FlexPaie, s'il en reste, est compté comme dû : le chiffre est prudent.

### 11. Menu des administrateurs regroupé : 8 entrées au lieu d'une vingtaine
- **Tableau de bord** : l'ancien « Administration » ; le doublon qui redirigeait est supprimé.
- **Argent** : Trésorerie, Retraits à traiter, Règlements.
- **Comptes** : Utilisateurs, Commerçants, Entreprises, Cartes.
- **Tarifs** : Commissions, Frais et limites, Abonnements, Mes dépenses (Pro).
- **Sécurité** : Alertes, Sécurité de l'application.
- **Mon compte** : Mes paiements, Ma carte, Mes dépenses.
- Puis Notifications et Paramètres.

Fonctionnement :
- Les pages d'un groupe sont des onglets en haut de chacune (`HubTabs`).
- Chaque page garde son adresse : anciens liens et notifications intacts. La recherche Ctrl+K trouve chaque page.
- Le compteur d'une page (retraits à envoyer) s'additionne sur son groupe.
- Un administrateur simple ne voit que les pages permises ; un groupe réduit à une page n'a pas d'onglets.
- Sur téléphone, la barre du bas des administrateurs devient : Accueil, Retraits, Alertes, Plus.
- Les autres comptes (clients, marchands, entreprises, employés) ne changent pas.

### 12. Contacts du support réglés par le super admin (migration 080)
- Plus aucun contact écrit dans le code : l'ancien « support@linkpay.cd / +243 800 000 000 » est supprimé.
- Le super admin les saisit dans **Paramètres → Contacts du support** : téléphone, WhatsApp, email.
  Les numéros et l'email sont vérifiés ; chaque changement est noté dans l'audit ; le code d'authentification est demandé.
- Ils s'affichent dans **Aide & support** (appel, WhatsApp, email en un clic) et sur l'écran **mot de passe oublié**.
  Lus avant la connexion (`GET platform/settings`).
- Un champ vide n'est pas affiché. Si rien n'est saisi : « Les contacts du support seront bientôt disponibles ».
- Avant la migration 080, rien ne casse : aucun contact n'est affiché.

### 13. Double authentification des administrateurs : suspendre pour un temps, réactiver (migration 081)
- Demandé pour le développement : le code à chaque connexion et avant chaque action sensible ralentit l'équipe.
- Où : **Sécurité → Sécurité de l'application**, super admin seulement.
  - Suspendre pendant 1 heure, 24 heures, 7 jours ou 30 jours. Jamais « pour toujours » : une suspension oubliée
    avant l'ouverture au public resterait.
  - Elle revient toute seule à la fin, ou dès que le super admin clique « Réactiver maintenant ».
- Pour suspendre, le code est demandé une dernière fois : quelqu'un qui n'a que le mot de passe ne peut pas la couper.
- Pendant la suspension, le mot de passe suffit pour se connecter et pour les actions sensibles. Un administrateur
  sans application d'authentification n'est plus envoyé vers sa configuration.
- Restent actifs : le mot de passe, la liste des réseaux autorisés (`ADMIN_ALLOWED_IPS`) et l'audit.
- Tous les super admins reçoivent une alerte à chaque suspension et réactivation.
- Un bandeau sur toutes les pages des administrateurs rappelle jusqu'à quand elle est suspendue.
- À la réactivation, les sessions ouvertes sans code doivent se reconnecter avec le code.
- Chaque serveur relit le réglage toutes les 15 secondes.
- Si le réglage est illisible (migration absente), le code reste demandé : jamais d'ouverture par erreur.

### 14. Ordinateur : les dernières pages encore étroites au centre
- Passées à la largeur commune (`max-w-6xl`), avec 2 colonnes sur grand écran :
  - Sécurité de l'application, Profil, Synchronisation ;
  - Abonnements, Mes dépenses (Pro) côté admin ;
  - Impression de carte (recto et verso côte à côte) ;
  - Tontine (détail et réglages), Épargne par arrondi ;
  - Transactions de l'entreprise (filtres sur une ligne), Mes ventes (4 chiffres sur une ligne) ;
  - Portefeuille de l'employé, Demandes d'achat (2 par ligne), Abonnement de l'entreprise, Inventaires.
- Le Profil affiche le rôle en français (« Super administrateur »), plus « super_admin ».
- Restent volontairement étroits, comme dans les applications de paiement :
  - les écrans d'argent (envoyer, retirer, payer, recharger, code PIN, demander un paiement), qui s'ouvrent dans la
    grande fenêtre élargie ;
  - l'assistant de création d'entreprise ;
  - les écrans de connexion.
- Encaisser par carte passe de 448 à 672 px.
- Rien ne change sur téléphone.

### 15. Code PIN refusé : les points ne restent plus figés en rouge
- Avant : après un mauvais code, les points restaient rouges pendant qu'on retapait, jusqu'à la vérification
  suivante. Certains écrans gardaient même le code refusé dans les cases.
- Maintenant, sur tous les écrans de code (verrouillage, PIN de paiement, d'envoi, de retrait, code d'accès,
  confirmation d'action sensible…), après un refus :
  - les points tremblent en rouge ;
  - le code refusé s'efface tout seul ;
  - les points redeviennent gris, prêts pour un nouvel essai ;
  - le motif reste écrit dessous jusqu'au premier chiffre tapé.
- Le premier chiffre tapé commence toujours un nouveau code, même si l'ancien n'était pas encore effacé.
- Sur les écrans où le code est saisi dans la page, un refus efface les cases et rouvre directement le clavier de code,
  avec le motif. Les cases ne sont rouges que tant que rien n'a été retapé.
- Fait une seule fois dans `PinKeypadScreen` et `PinInput` : tous les écrans en profitent.

### 18. Alléger ce que paie le client (23/10/2026)
- **Constat** : abonnement de 1 USD, commission payée par le client.
  - La vraie commission (2,5 %, minimum 0,05 USD) était **arrondie au dollar supérieur**, parce que Mobile Money n'accepte que des
    unités entières : 1 USD de commission.
  - FlexPaie ajoutait ses ~2 % : 2,04 USD débités pour 1 USD.
  - Et 1,5 % « frais du fournisseur » étaient en plus retenus au marchand, alors que FlexPaie les fait déjà payer au client.
- **Désormais** :
  - la part du client est arrondie **vers le bas** à l'unité entière ; les centimes restants sont retenus au marchand ;
  - le client ne paie jamais plus que la vraie commission, et la commission de ScanLinkPay ne change pas ;
  - plus de retenue « frais du fournisseur » (`estimatePspFee` = 0) : FlexPaie facture ses frais au payeur et crédite le montant
    demandé ;
  - le grand livre n'écrit plus de ligne de frais à zéro.
- **Exemples** (commission payée par le client) :

  | Paiement | Débité avant | Débité désormais | Le marchand reçoit |
  |---|---|---|---|
  | 1 USD | 2,04 USD | 1,02 USD | 0,95 USD |
  | 59 USD | 61 USD + frais FlexPaie | 60 USD + frais FlexPaie | 58,53 USD |

### 17. Paiement avec commission à la charge du payeur : débité, jamais crédité (corrigé)
- **Constat** : abonnement HotelSaver de 1 USD, commission payée par le client.
  - FlexPaie a débité 2,04 USD, le total demandé.
  - Mais `handleSuccessfulPayment` comparait la confirmation au montant SANS commission (`amount_cents`).
  - Résultat : « montant différent », rien de crédité, le paiement resté en attente et l'écran du payeur figé.
- **Correction** : la confirmation se compare à `total_cents`, ce qui a été demandé au fournisseur, comme les transferts le faisaient
  déjà avec montant + frais.
- **Le paiement déjà bloqué se rattrape tout seul** après le déploiement :
  - ScanLinkPay relit ses paiements en attente pendant 72 h ;
  - HotelSaver attend 24 h avant d'abandonner.

### 16. Supprimer son compte : sur le site, avec la raison du départ (migration 082, exigence Google Play)
- Dans Paramètres, le bouton « Supprimer mon compte » ouvre la page `/supprimer-mon-compte` du site (le navigateur du téléphone dans
  l'application Android). Pas besoin d'un autre site : la version navigateur sur Render sert de site.
- **Qui peut** : un client, un marchand (sa boutique ferme) et le patron d'une entreprise (l'entreprise ferme).
  **Ne peuvent pas** : les employés (vendeur/caissier, gérant, magasinier, comptable…) et les administrateurs. Leur compte est retiré
  par le patron.
- **Avant** : solde à zéro (CDF et USD), épargne vide, aucun retrait en cours, aucune tontine en cours, et l'équipe retirée.
  La suppression ne touche jamais à l'argent.
- **Étapes** : la raison du départ (6 choix et un commentaire libre), le mot de passe et une case « définitif ».
  - Les raisons vont dans `account_deletions`, sans nom ni téléphone.
- **Effet** :
  - la connexion est bloquée ;
  - nom, téléphone, email, photo et codes sont effacés ;
  - cartes bloquées, portefeuille fermé, appareils oubliés ;
  - les opérations financières restent, sans le nom, comme la loi l'exige ;
  - le numéro et l'email peuvent rouvrir un compte plus tard.
- La page publique `/confidentialite` a été rédigée d'après ce que l'application collecte vraiment.
- `docs/PLAY_STORE.md` contient :
  - les réponses au formulaire « Sécurité des données » ;
  - la construction de l'AAB signé (clé hors du dépôt, `android/keystore.properties` ou variables `SLP_UPLOAD_*`) ;
  - la liste des captures ;
  - le point de vigilance sur les abonnements payés dans l'application.

### Reste à décider (non corrigé)
- Le stock n'est pas réservé pendant l'attente : voulu, le stock bouge au paiement (si l'article est parti
  entre-temps, les espèces sont refusées).

### 6. Le QR d'une vente expire après 15 minutes (pratique standard des QR « dynamiques »)
- Deux sortes de QR, comme dans les applications de paiement : le **QR fixe** du commerçant (« Encaisser ») n'expire
  jamais ; le **QR d'une vente** (un montant, une vente) expire. Exemples relevés :
  - PhonePe : durée réglée à chaque vente, en secondes ;
  - Stripe Checkout : 30 min à 24 h ;
  - Xendit : 48 h par défaut.
  En boutique, le client est devant le vendeur, d'où une durée courte : **15 minutes** (`SALE_QR_TTL_MS`).
- La date d'expiration est enregistrée sur le QR de la vente (`payment_requests.expires_at`, sans nouvelle migration).
  Le paiement par ScanLinkPay la vérifiait déjà (« Cette facture a expiré »).
- À l'expiration, la vente non payée passe en « Annulée » : chaque minute (`SalesExpiryService`, avec verrou), et tout
  de suite quand l'écran du vendeur la relit. Le QR n'est fermé que si personne n'est en train de le payer : un client
  qui a confirmé son PIN juste avant garde son paiement. Le stock n'a jamais bougé.
- Les espèces sur une vente expirée sont refusées.
- Le vendeur voit le temps restant et, à l'expiration, **« Relancer la vente »** : mêmes articles, nouveau QR,
  nouvelles 15 minutes (le stock est revérifié).

---

## 22/10/2026 — Mode hors ligne : consulter, noter ses dépenses, vendre en espèces, gérer le stock ; jamais de transfert d'argent

Demande du propriétaire : un mode hors ligne « comme HotelSaver », mobile (Android) et bureau (Windows, le site).
Règle de fond : **aucun mouvement d'argent sans le serveur** (seul lui connaît le vrai solde ; hors ligne, on pourrait
dépenser deux fois le même argent). Ce qui est fait :

- **Réseau** (`lib/network.ts`) : l'application sait si le serveur répond (chaque réponse ou absence de réponse de l'API
  compte, `navigator.onLine` seul ment) et garde l'heure de la dernière connexion. Hors ligne, un petit appel public
  toutes les 15 s détecte le retour.
- **Bandeau** (`components/OfflineBanner.tsx`) sous la barre du haut : « Hors ligne · données de 14:05 · 1 en attente »,
  puis « De nouveau en ligne » ; rien quand tout va bien.
- **File d'attente** (`lib/outbox.ts`, `lib/outbox-handlers.ts`, `hooks/useOutboxRunner.ts`) : chaque opération faite
  hors ligne reçoit son identifiant sur le téléphone (`client_ref`), part dans l'ordre au retour du réseau ; pas de
  réponse → elle attend ; serveur occupé → réessai espacé ; **refusée (4xx) → mise de côté avec la raison, jamais
  renvoyée seule** ; gardée par compte sur l'appareil. Écran **Synchronisation** (`/dashboard/sync`, menu Plus).
- **Écrans d'argent** (envoyer, recharger, retirer, payer, encaisser par carte, nouvelle demande) : ouverts sans réseau,
  ils expliquent pourquoi (`RequireOnline`) ; ouverts en ligne, ils ne disparaissent pas sur une courte coupure.
- **Déverrouillage par code sans réseau** (`lib/offline-code.ts`) : après chaque vérification en ligne réussie,
  l'appareil garde une empreinte du code (PBKDF2-SHA256, sel aléatoire, 200 000 tours), jamais le code. Hors ligne :
  comparaison locale, **5 erreurs → empreinte effacée, seul le serveur peut déverrouiller**. Effacée aussi au
  changement / à la réinitialisation du code et à la déconnexion. Le déverrouillage n'ouvre que l'écran.
- **Mes dépenses (carnet)** : une dépense notée sans réseau attend et part seule. API : `client_ref` + `noted_at`
  (heure réelle de la note, 30 jours max, jamais dans le futur) ; **migration 073** (`expense_entries.client_ref`, index
  unique par utilisateur) : la même note envoyée deux fois est gardée une fois. Sans la migration, la note passe quand
  même (sans protection contre le double). Ouvrir une nouvelle page du carnet et la clôturer restent en ligne.
- Le site et l'application Windows (qui charge le site) s'ouvrent hors ligne grâce au service worker (tous les écrans
  sont mis en cache ; vérifié sur la version construite : pages rouvertes sans réseau) ; l'APK Android embarque
  l'application. Application Windows lancée pour la toute première fois sans réseau : page « Pas de connexion
  Internet » qui réessaie seule toutes les 15 s (`linkpay-desktop/src/main.js`) au lieu d'un écran vide.

### Point 2 — la caisse et le stock hors ligne (mobile et bureau)
- **Vendre sans réseau** (`pages/pos/PosTill.tsx`, `PosOfflinePayment.tsx`) : sans réseau et sans ticket ouvert sur le
  serveur, la caisse vend seule : articles ajoutés sur l'appareil (stock vérifié contre le dernier état connu), panier
  gardé sur l'appareil (fermeture de l'appli, rechargement), **paiement en espèces uniquement** (ScanLinkPay demande le
  serveur), monnaie calculée, reçu imprimé avec un numéro provisoire « HL-… » et la mention « Vente enregistrée hors
  ligne ». Le stock affiché baisse tout de suite sur cette caisse. Réseau revenu en pleine vente : la vente continue
  normalement en ligne.
- **Coupure pendant un ticket déjà sur le serveur** : bouton « Continuer hors ligne » (si aucun paiement n'y est
  encore) ; les lignes passent sur l'appareil, le ticket du serveur est annulé au retour du réseau (jamais payé deux
  fois). Le ticket ouvert est gardé entier sur l'appareil pour s'afficher même hors ligne.
- **Serveur** : `POST /merchants/:id/pos/offline-sales` → fonction SQL `record_offline_pos_sale()` (**migration 074**)
  qui écrit ticket, lignes, paiement espèces et sortie de stock **en une seule transaction, une seule fois par
  `client_ref`**, à l'heure réelle de la vente (7 jours max). **L'argent encaissé gagne toujours** : ce que la caisse
  ne pouvait pas savoir est signalé, jamais refusé — prix changé entre-temps (vendu au prix payé), stock déjà vendu
  par une autre caisse (la sortie s'arrête à zéro et les unités manquantes sont listées pour l'inventaire), session de
  caisse fermée entre-temps (rattachée à la dernière session). Ces cas vont dans `pos_tickets.offline_conflicts` et
  au **Journal** (`offline_sale_with_conflicts`). Refus (4xx, mis de côté dans Synchronisation) seulement si un
  article a été supprimé ou a changé de devise. Vérifié sur une vraie base PostgreSQL (vente, double envoi, stock
  insuffisant, prix changé, session fermée, article inconnu sans rien laisser à moitié).
- **Clôture de caisse** bloquée tant que des ventes hors ligne de cette caisse ne sont pas parties (sinon le comptage
  ne correspondrait pas) et hors ligne.
- **Stock** : entrée / sortie / ajustement d'un article (`StockItemDetailDialog`) se font aussi hors ligne
  (`stock_movements.client_ref`, appliqué une fois). Une sortie plus grande que le stock réel est refusée au retour
  (visible dans Synchronisation). Créer ou modifier un produit reste en ligne.
- Risque accepté : hors ligne, la caisse ne peut pas vérifier le prix auprès du serveur ; un prix modifié sur
  l'appareil est enregistré mais tracé (conflit `price_changed` dans le Journal).

### Point 3 — tous les autres gestes du quotidien des entreprises (22/10, demande du propriétaire)
Vérification module par module : le module **« Ventes »** (vendeur → facture → encaissement, utilisé par les boutiques,
l'électronique…) n'était pas encore hors ligne. Fait (migration **075**) :
- **Ventes** (`pages/organization/Sales.tsx`) : hors ligne, « Encaisser en espèces » enregistre la vente sur l'appareil,
  la facture s'imprime aussitôt (référence `SALE-HL-…`, mention « PAYÉE — ESPÈCES » et « Vente enregistrée hors ligne »,
  à l'écran et en PDF ; une facture déjà payée n'invite plus à payer). Serveur : `POST /organizations/:id/sales/offline`
  → `record_offline_org_sale()`, mêmes règles que la caisse (une fois, l'argent gagne, conflits au Journal). Une vente
  déjà créée en ligne puis encaissée en espèces sans réseau : l'encaissement attend et part au retour (`sales.cash`) ;
  s'il est refusé (payée entre-temps par ScanLinkPay), il reste dans Synchronisation pour vérification humaine.
- **Inventaire** : les quantités comptées se sauvegardent hors ligne (renvoyer une quantité comptée donne le même
  résultat). Démarrer et valider un inventaire restent en ligne (la validation attend l'envoi des comptages).
- **Demandes d'achat** (réapprovisionnement) : écrites hors ligne, créées une seule fois (`restock_requests.client_ref`).
- **Entrées / sorties d'espèces du tiroir** (petite dépense, dépôt) : hors ligne, une seule fois
  (`cash_movements.client_ref`) ; la clôture attend leur envoi.
Restent en ligne : créer ou modifier un produit, ouvrir / clôturer une caisse, mettre un ticket de caisse en attente,
tout ce qui déplace de l'argent ScanLinkPay (paiement par QR / portefeuille, carte, envoi, retrait, recharge).

À faire : migrations 073, 074 et 075 (Test puis production), puis Manual Deploy de l'API et du site, et nouvelle APK.

---

## 21/10/2026 (soir) — Nouvelle interface (maquette ScanLinkPay 2026, clair et sombre)

Le propriétaire a fourni une maquette à suivre « textuellement » (écrans client et marchand, mode clair et sombre).
Choix faits avec lui : **client et marchand d'abord** (la charte s'applique partout, les écrans entreprise / caisse /
admin seront peaufinés ensuite) ; **« Mes dépenses » = camembert automatique + carnet manuel en dessous** ; **taux
CDF/USD indicatif réglé par le super admin** ; **avatar = silhouette** (pas de photo de profil pour l'instant).

- **Charte** (`linkpay-web/src/index.css`, `tailwind.config.js`) : **le bleu électrique du logo `#1230F8`** (22/10, demande du propriétaire,
  à la place du violet ; choisi pour ne pas ressembler au marine `#0F2742` / bleu `#1769E0` de HotelSaver) : dégradé
  `bg-brand-gradient` du bleu nuit `#0A1270` au bleu du logo (carte de solde, boutons, onglet actif), bleu clair du
  « Pay » du logo `#15B8FE` (`text-brand-sky`) pour « Pay » et les titres en dégradé, partout y compris la page d'accueil (plus aucun violet) ; police **Inter** ;
  montants écrits « 2 950,00 CDF » / « 5,12 $US » (`formatCurrency`).
- **Thème** appliqué dès la première image, même avant la connexion : `public/theme-init.js` (fichier séparé : la CSP
  Android interdit les scripts en ligne).
- **Barres** : barre du haut (logo, cloche, avatar silhouette `UserAvatar`) ; barre du bas à plat, quatre onglets pour
  client et marchand : Accueil, Transactions, Encaisser / Recevoir, Plus (Paramètres passe dans Plus).
- **Onglet Transactions** (client, marchand) = historique du portefeuille (`/dashboard/wallet/transactions`) : recherche,
  Toutes / Entrées / Sorties, icônes colorées par type (`LedgerItem`). L'API ajoute `counterparty` à chaque ligne (nom de
  l'autre personne, du marchand, du réseau de retrait — affichage seulement, `withCounterparties`). L'ancienne page
  « Transactions » du marchand (paiements de ses clients, avec remboursements) s'appelle maintenant **« Paiements reçus »**.
- **Écrans d'argent** (Envoyer, Recharger, Retirer, Encaisser, Payer, PIN, nouvelle demande) : en **pleine page** sur
  téléphone (`FormSheet fullPage` : flèche retour + titre) au lieu du panneau qui monte du bas. Envoyer : bénéficiaire,
  montant, « ≈ x $US », montants rapides, motif. Retrait : on choisit d'abord le **point de retrait** (réseau ou banque).
- **Mes dépenses** : `GET /wallet/spending?period=1m|3m|6m&currency=` (débits du portefeuille par catégorie ; un retrait
  échoué et rendu ne compte pas) → camembert `SpendingOverview` ; le carnet manuel reste en dessous.
- **Taux indicatif** : colonne `platform_settings.cdf_per_usd` (migration **072**), lue publiquement
  (`GET /platform/settings`), réglée dans Administration → Frais et limites. **N'effectue jamais de conversion.**
- **Écran du code d'accès** aux couleurs de la charte (dégradé, carte et clavier qui suivent le thème).
- **Connexion / Inscription** (`components/auth/AuthShell.tsx`, `AuthField.tsx`) : même carte sur téléphone et ordinateur.
  Téléphone : en-tête dégradé + vague, carte en haut (pas recentrée à l'ouverture du clavier). Ordinateur : panneau
  « Bienvenue sur / Rejoignez ScanLinkPay » + trois atouts + illustration, lien de bascule en haut à droite. **Rien ne
  bouge pendant la saisie** : ligne de message réservée sous chaque champ, jauge du mot de passe toujours présente,
  champs en 16 px (pas de zoom), erreurs e-mail / mot de passe à la sortie du champ (vérifié : 0 px de décalage).
- **Écran du code PIN / code d'accès** (`components/PinKeypadScreen.tsx`, maquette « Écran d'authentification PIN ») :
  un seul écran pour toutes les saisies de code (ouverture de l'application, envoi, retrait, paiement, carte, épargne,
  tontine, abonnement…). Téléphone : dégradé bleu, logo, carte avec un point par chiffre et le numéro masqué
  (`•••••••567`), pavé de touches arrondies, « Entrée » en dégradé quand le code est complet. Ordinateur : barre
  (logo, « Sécurisé »), fond à courbes, tout dans une carte centrée. Pas de champ texte : rien ne bouge pendant la
  saisie (ligne d'erreur réservée). « Code oublié ? » s'ouvre dans une petite fenêtre (`PinDialog`) au-dessus de
  l'écran du code, flouté et assombri (Échap ou un appui à côté pour fermer).
- **Pages publiques** (lien de paiement, payer par numéro, résultat, retour de la banque, carte scannée) : cadre commun
  `components/public/PublicShell.tsx` (bande dégradée, logo, « Paiement sécurisé »). Le lien de paiement se lit comme un
  reçu (commerçant, gros montant, référence) puis « Payer avec mon solde » ou Mobile Money sans compte (le choix
  « Carte bientôt » est retiré de cette page). Payer par numéro : montant entier (les prestataires ne prennent pas de
  centimes), comme la recharge.
- **Écrans de résultat** (`components/ResultView.tsx`) : même écran partout (paiement, recharge, envoi, Pro, liens
  expirés) : grande icône, montant en gros, détails façon reçu avec référence copiable, actions.
- **Mot de passe oublié, nouveau mot de passe, code de secours, double authentification admin** : même cadre que la
  connexion (`AuthShell`, titre facultatif).
- **Pages du portefeuille et du marchand** : en-tête commun (`PageHeader`) avec bouton retour rond ; listes en français
  (plus de « PENDING » / « SUCCESS » : `TransactionItem`, demandes de paiement) avec filtres en pastilles
  (`components/ui/filter-chips.tsx`) ; Nouvelle demande et Encaisser par carte utilisent la même saisie de montant que
  la recharge (`AmountEntry`, montants entiers) ; Équipe affiche les rôles (Propriétaire / Caissier) ; Ma carte,
  Paramètres (préférences d'abord) et le scanner (cadre de visée, bouton manuel de nouveau lisible) retouchés.
  Tontines et Épargne ne sont pas retouchées : elles sont masquées (`lib/features.ts`).
- Vérification : banc de captures Playwright (API simulée) clair/sombre, `npm run build`, 722 tests API.

À faire : migration 072 (Test puis production) ; puis peaufiner les écrans entreprise, caisse, vendeur et admin avec
la même charte.

---

## 21/10/2026 — Retraits automatiques FlexPaie, plus d'argent fictif, base de test séparée

Branche `claude/gifted-brahmagupta-o286hw` (10 commits, de `b73ff34` à la dernière). **À fusionner dans `main` seulement
après les migrations en production** (voir « Déploiement » ci-dessous).

### 1. Retraits Mobile Money automatiques (FlexPaie PayoutService)
- **Quoi** : `FlexPaieAdapter.payout()` / `getPayoutStatus()` / `acceptPayoutCallback()`
  (`linkpay-api/src/payments/psp/providers/flexpaie.adapter.ts`, fin du fichier), d'après la « Documentation FlexPaie
  Payout » v1.03 (confidentielle, pas dans le dépôt) : connexion `POST …/api/v1/auth/authenticate` (jeton gardé jusqu'à
  une minute avant expiration), envoi `POST …/pay`, vérification `GET …/check/<orderNumber>`.
- **Pourquoi « sans admin »** : décision du propriétaire, les retraits Mobile Money ne passent plus par la page
  « Retraits à traiter ». Seuls les **retraits bancaires** restent manuels (FlexPaie n'envoie que vers le Mobile Money),
  ainsi que tous les retraits tant que `FLEXPAIE_PAYOUTS_ENABLED` n'est pas `true`.
- **Journal `flexpaie_payouts`** (migration `067`), écrit **avant** l'envoi : un retrait ne peut jamais partir deux fois.
  États : `SENDING`, `ACCEPTED`, `NOT_SENT`, `ABANDONED`.
- **Réponses FlexPaie** : `0XX0` accepté (suivi chaque minute) ; `0XX1` occupé → nouvel essai à la minute suivante,
  abandon et remboursement après 24 h ; `0XX2` solde FlexPaie insuffisant / `0XX4` jeton / connexion refusée →
  remboursement immédiat + alerte critique admins ; `0XX3` numéro non pris en charge, `0XX5` autre → remboursement avec le
  message.
- **Réponse perdue** (délai dépassé) : ni renvoyé ni remboursé ; le rappel FlexPaie apporte le numéro de commande
  (vérifié chez FlexPaie : notre référence + même montant + même devise). **Sans nouvelles après 30 min → remboursé**
  (choix du propriétaire). Si FlexPaie confirme plus tard l'envoi → alerte « Retrait payé ET remboursé ».
- **Là où la documentation se tait, choix appliqués** (le propriétaire ne veut plus poser de questions à FlexPaie) :
  même codes de statut que la vérification des paiements (même adresse `check`) : 0 envoyé, 2 en cours, 1/3/4/5 échoué,
  autre = on attend ; référence **neuve à chaque essai** `RET-<16 hex>-<essai>` (22–25 caractères) ; montants entiers,
  minimum **100 CDF / 1 USD**, refusés **avant** de débiter ; maximums = limites de retrait de l'administration ;
  jeton de vérification : PayoutService, puis reconnexion, puis jeton des paiements en dernier recours.
- **Anciens retraits manuels en attente** : envoyés automatiquement à l'activation (choix du propriétaire) → vider la page
  « Retraits à traiter » AVANT d'activer.
- **Couper `FLEXPAIE_PAYOUTS_ENABLED`** n'abandonne rien : un retrait déjà confié à FlexPaie reste suivi et n'apparaît
  jamais dans la page manuelle (`payoutsInFlight`).
- **Rappel** : `POST /api/v1/webhooks/payouts/flexpaie` (`wallets/withdrawal-callbacks.controller.ts`), jamais cru.
- Variables Render : `FLEXPAIE_PAYOUT_AUTH_URL`, `FLEXPAIE_PAYOUT_URL`, `FLEXPAIE_PAYOUT_CHECK_URL` (facultative),
  `FLEXPAIE_PAYOUT_USERNAME`, `FLEXPAIE_PAYOUT_PASSWORD`, `FLEXPAIE_PAYOUT_MERCHANT` (facultative),
  `FLEXPAIE_PAYOUTS_ENABLED=true` en dernier. Détail : `docs/FLEXPAIE.md`, `docs/RENDER_ENV.md`.

### 2. Sécurité (revue anti-fraude)
- **Pause de 24 h** (migration `068`, `src/common/security-hold.ts`) : après un changement de mot de passe (y compris par
  lien e-mail), de PIN (y compris le premier), de téléphone ou d'e-mail, **aucune sortie d'argent** : retrait, transfert,
  paiement marchand par le solde, remboursement marchand. Les dates sont posées par des déclencheurs (`profiles`,
  `auth.users`). Choix du propriétaire contre le vol de compte.
- Contrôle de risque des retraits : **refus** si l'historique est illisible (avant : passait).
- `amount_cents` d'un retrait : entier obligatoire.

### 3. Plus aucun argent fictif dans l'application
- **Prestataire `mock` supprimé** (il faisait « réussir » tout seul recharges, paiements, transferts financés, abonnement
  Pro, retraits, et c'était le défaut si `PSP_PROVIDER` manquait). Sans vrai prestataire, l'API **refuse**.
- **CinetPay supprimé** du projet (jamais utilisé) : adaptateur, `cinetpay-js`, variables `CINETPAY_*`. FlexPaie est le
  seul prestataire. L'abonnement Pro payé par le prestataire : route `pro/activate/mobile-money`, valeur
  `payment_method = 'mobile_money'` (migration `070`).
- **Argent de test** (migration `069`) : uniquement depuis l'éditeur SQL (`credit_test_money` / `remove_test_money`,
  interdits à l'API et aux utilisateurs). Le portefeuille devient `wallets.is_test` et l'argent reste **enfermé** :
  jamais de retrait, jamais vers un vrai portefeuille / marchand / client (API `src/common/test-money.ts` + déclencheurs).
- **Argent fictif déjà en base** (anciennes recharges `mock`) : requête de repérage dans `docs/RECHARGE_TEST.md`, à
  traiter **avant** d'activer les retraits automatiques (décision humaine pour chaque portefeuille).

### 4. Deux bases Supabase : production et « LinkPay Test »
- Migration `071` : chaque base est marquée `production` ou `test` **pour toujours** (`platform_environment`).
  Production : `credit_test_money` refusé. Test : l'API refuse **tout paiement réel** (lu au démarrage par `PspFactory`).
- La base de test se construit d'un coup avec `linkpay-api/supabase/base_test.sql` (généré par
  `node supabase/construire-base-test.js`, vérifié sur une base vide envoyé en un seul bloc comme l'éditeur Supabase).
  L'ancien `setup_new_project.sql` (arrêté à 023) est supprimé.
- Les migrations en double (033/036, 034/037, 035/038) sont identiques : une seule de chaque dans `base_test.sql`.
- Mode d'emploi : `docs/BASE_TEST.md`.

### Déploiement (dans cet ordre)
1. **Production → SQL Editor** : `067_flexpaie_payouts.sql`, `068_security_hold.sql`, `069_test_money.sql`,
   `070_expense_pro_payment_method.sql`, `071_platform_environment.sql`.
2. Vérifier sur Render `PSP_PROVIDER=flexpaie` (sinon tous les paiements sont refusés).
3. Fusionner la branche dans `main` (Render redéploie `linkpay-api` et `linkpay-web` : les deux ensemble, le site appelle
   la nouvelle route Pro).
4. Plus tard, pour les retraits automatiques : variables `FLEXPAIE_PAYOUT_*`, page « Retraits à traiter » vidée, argent
   fictif ancien traité, puis `FLEXPAIE_PAYOUTS_ENABLED=true` et un retrait réel de 100 CDF par réseau.

Si le code part avant les migrations : 067 → la page manuelle reste correcte ; 068, 069, 071 → simplement non appliqués
(journalisé) ; 070 → le paiement Pro par Mobile Money échoue jusqu'à la migration.

### Risques acceptés (coût pour ScanLinkPay, jamais pour le client)
- Remboursement après 30 min sans nouvelles alors que FlexPaie a quand même envoyé (alerte critique).
- Ancien retrait déjà payé à la main mais non marqué, renvoyé à l'activation (d'où « vider la page »).
- Statut de vérification : si FlexPaie utilisait un autre code que 2 pour « en cours », un retrait serait remboursé à
  tort ; les tests réels de 100 CDF le montreraient tout de suite.

## Sons et voix : bip de scan, voix de femme, alertes de stock répétées, messages Mobile Money (27/10/2026)

- **Voix** : clips enregistrés (ElevenLabs, voix « Delphine ») dans `linkpay-web/public/sounds/voice` — « Please try again » en anglais, le reste en français ; même voix sur tous les téléphones, hors ligne (préchargés par le
  service worker). Le nom du produit d'une alerte de stock est lu par la voix de l'appareil. Bip et voix suivent le volume média ; chacun se coupe dans Paramètres › Application. « Votre solde est suffisant » n'est PAS annoncé :
  la réussite d'un paiement a déjà son message, seul l'échec (« Solde insuffisant », « Paiement échoué ») mérite la voix.
- **Alerte de stock** : un article qui franchit son seuil est annoncé (déjà le cas), puis rappelé toutes les 24 h par un cron horaire (`StockService.sendLowStockReminders`, colonne `stock_items.low_alert_sent_at`)
  tant que le stock n'est pas rechargé. Chaque utilisateur peut la couper pour un article ou en bloc (`stock_alert_mutes`, migration 087 à appliquer sur Test puis Prod). Application fermée : push FCM avec canaux Android
  `stock_alert` / `stock_out` (sonnerie = la voix, `res/raw`).
- **Messages d'échec Mobile Money** : `explainMobileMoneyRefusal` traduit le refus du fournisseur (solde, PIN, limite, numéro, réseau) en phrase claire avec l'opérateur du numéro ; un message qui parle du solde MARCHAND n'est pas
  attribué au payeur. Après un paiement lancé puis échoué, FlexPaie ne dit jamais POURQUOI : l'écran liste les causes usuelles, la plus probable d'abord (`mobileMoneyFailedAdvice`).
