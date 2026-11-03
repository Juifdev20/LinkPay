# Procédure complète — tests d'homologation DGI avec ScanLinkPay

But : produire les factures des cas de test (document « Cas de test SFE » v1.2) en TTC et en HT, plus les rapports X, Z et A,
sur l'e-MCF de **test** de la DGI, les vérifier et les photographier pour le dossier d'homologation.

---

## Étape 0 — Une seule fois, avant tout

1. **Base de données** : dans Supabase (l'environnement ScanLinkPay que vous utilisez pour les tests), éditeur SQL, exécuter
   dans l'ordre `linkpay-api/supabase/migrations/090_facture_normalisee.sql` puis `091_rapports_fiscaux.sql`.
2. **Render** (service API) → Environment :
   - `FISCAL_TOKEN_ENCRYPTION_KEY` = une longue clé secrète (par exemple le résultat de `openssl rand -hex 32`). Ne la donnez à personne.
   - `FACTURE_NORMALISEE_ACTIVE` = `true` (reprise automatique des bons provisoires chaque minute).
   - **Ne pas** mettre `EMCF_ISF` : il n'existe qu'après l'homologation.
   - Enregistrer et laisser Render redéployer.
3. **Votre compte** : connectez-vous avec le compte **patron** (propriétaire) de l'entreprise de NIF A2216742Y. Vérifiez que vous
   avez un **code PIN de transaction** (Profil → Code PIN de transaction) : les avoirs le demandent.

## Étape 1 — Portail e-DEF de la DGI (developper.dgirdc.cd)

1. Attendre la validation de la demande d'e-MCF « SCANLINKPAY CAISSE TEST 1 ».
2. Dans « Gérer les e-DEF », l'e-MCF apparaît avec son NID/NIM et l'état actif.
3. Créer ou afficher le **jeton** de cet e-MCF et le **copier**. Ne l'envoyez à personne, ni par message ni en capture.

## Étape 2 — Paramètres dans ScanLinkPay

Menu **Facture normalisée DGI** → onglet **Paramètres**.

1. **Identité fiscale** :
   - NIF de l'entreprise : `A2216742Y`
   - Régime TVA : Assujetti
   - Prix unitaires : TTC (l'écran des tests choisit lui-même TTC ou HT)
   - Groupe des produits sans groupe : B
   - Dénomination : `CONGO CONSULTING ENTREPRISE`
   - Adresse, téléphone, e-mail : les mêmes que sur la demande e-DEF (Matonge rue numéro 3, Beni · 0828497218 · scanlinkpay@gmail.com)
   - **Enregistrer**.
2. **Jeton e-MCF (DGI)** : coller le jeton → **Enregistrer**. ScanLinkPay l'essaie auprès de la DGI ; vous devez lire
   « Connecté à la DGI » et le numéro de l'e-MCF. Sinon, le message dit pourquoi (jeton invalide, expiré…).
3. **Facture normalisée** : activer l'interrupteur. Le bandeau « Mode test DGI » doit rester affiché.

## Étape 3 — Lancer les cas de test

Onglet **Tests DGI**.

1. Le bandeau vert doit dire « Prêt : e-MCF de TEST, NIF A2216742Y ». Sinon, il liste ce qui manque.
2. **Campagne** : cliquer sur **Nouvelle** (une campagne = une série complète).
3. **Clients de test** (facultatif) : par défaut le NIF de l'entreprise, que l'e-MCF de test connaît.
4. Mode **TTC** → saisir le **code PIN** → **Lancer les cas restants**. Chaque cas prend quelques secondes.
5. À la fin : chaque cas est « Réussi », « Échec » (avec la raison) ou « Hors périmètre » (groupes non déclarés : cas 14, 18, 20,
   21, 23, 24, 28 — ils ne sont pas demandés).
6. En cas d'échec : lire le message, cliquer sur **Réessayer**. Si l'échec persiste, envoyer le **Récapitulatif (tableur)** au
   développeur. Un cas « À vérifier » : le chercher d'abord sur le site de vérification de la DGI, ne rien relancer.
7. Passer en mode **HT** et relancer (même campagne).

## Étape 4 — Preuves pour le dossier

Pour **chaque cas réussi**, en TTC puis en HT :

1. **Voir et imprimer** → imprimer la facture (imprimante thermique, ou PDF depuis l'impression système).
2. **Vérifier** sur https://developper.dgirdc.cd/sygdef/verification : saisir les informations demandées, cliquer sur « Vérifier »,
   et comparer avec la facture ScanLinkPay : vendeur et client, montants (total, TVA), articles, éléments de sécurité, code QR.
3. **Photographier la facture ScanLinkPay** (pas celle du site de la DGI) et l'insérer dans le document « Cas de test SFE » sous
   le cas concerné : deux photos par cas (TTC et HT). Pour un cas hors périmètre, écrire « Groupe non déclaré — hors périmètre ».

## Étape 5 — Rapports (R01 à R03)

Onglet **Rapports X / Z / A**, après les factures :

1. **Rapport X** → Imprimer → photo (R01).
2. **Clôture Z** → confirmer → Imprimer → photo (R02). Le Z ferme la période ; il ne se refait pas.
3. **Rapport A (articles)** → Imprimer → photo (R03).

## Étape 6 — Après les tests

1. Télécharger le **Récapitulatif (tableur)** et le garder avec les photos.
2. Envoyer au développeur le récapitulatif (et les échecs s'il y en a).
3. Compléter le dossier d'homologation (demande, tableaux de conformité, document des cas de test avec photos) et l'envoyer
   à la DGI (courriers prêts dans `docs/facture-normalisee/COURRIERS_DGI.md`).

## Si quelque chose bloque

| Message | Que faire |
|---|---|
| « Enregistrez le jeton e-MCF » | Étape 2.2 |
| « Jeton invalide » / « expiré » | Recréer le jeton sur le portail e-DEF, le recoller |
| « Faites d'abord le cas n° X » | Un avoir dépend de sa facture d'origine : lancer d'abord le cas X |
| « Un avoir demande votre code PIN » | Saisir le code PIN de transaction avant de lancer |
| « Montants différents de la DGI » | Ne rien changer ; envoyer le récapitulatif au développeur |
| « Taux du dollar indisponible » (cas 26) | Réessayer quelques minutes plus tard |
| La DGI ne répond pas | La facture reste en attente ; « Réessayer » plus tard |
