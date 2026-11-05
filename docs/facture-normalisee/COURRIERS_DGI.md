# Courriers à la DGI — facture normalisée (ScanLinkPay)

Remplacer les éléments entre crochets avant l'envoi : [Dénomination sociale], [NIF], [RCCM], [Adresse], [Nom et fonction
du représentant], [Téléphone], [E-mail]. Ne jamais joindre ni écrire un jeton e-MCF dans un courriel.

---

## Courrier 1 — Questions techniques (à envoyer maintenant)

**À :** assistancesfe@dgirdc.cd
**Cc :** homologationsfe@dgirdc.cd
**Objet :** SFE « ScanLinkPay » — intégration e-MCF : demande de précisions avant conception

Madame, Monsieur,

La société [Dénomination sociale] (NIF [NIF], RCCM [RCCM]) édite **ScanLinkPay**, un système de facturation d'entreprise
(SFE) en ligne utilisé par des commerces, supermarchés et restaurants en République Démocratique du Congo, sur téléphone
Android, ordinateur Windows et navigateur. Nous disposons d'un compte sur la plateforme de test e-DEF
(developper.dgirdc.cd) et nous préparons l'intégration de l'e-MCF (API v1.3) en vue de l'homologation.

Avant de concevoir les modifications, nous souhaitons obtenir les précisions suivantes :

1. **SFE connecté uniquement à l'e-MCF.** ScanLinkPay est hébergé en ligne et se connectera à l'e-MCF, sans MCF
   physique. Pouvez-vous nous confirmer qu'un tel SFE peut obtenir l'homologation (transitoire puis complète) ? Le guide
   « Mise à jour et homologation des SFE » v1.2 mentionne une connexion au MCF et à l'e-MCF.

2. **Coupures d'Internet.** Nos clients subissent des coupures de réseau. Puisqu'une facture ne peut être finalisée sans
   les éléments de sécurité, quelle solution la DGI accepte-t-elle pendant une coupure :
   a) un reçu provisoire non fiscal, remplacé par la facture normalisée dès le retour du réseau (dans quel délai maximal,
      et avec quelles mentions sur le reçu provisoire ?) ;
   b) l'utilisation d'un MCF physique à la caisse ;
   c) l'interdiction de facturer tant que la connexion n'est pas rétablie ?

3. **Un SFE pour plusieurs contribuables.** ScanLinkPay est utilisé par de nombreuses entreprises, chacune avec son NIF.
   Pouvez-vous confirmer que chaque client crée son propre e-MCF et son propre jeton sur la plateforme e-DEF, qu'il
   enregistre ensuite dans ScanLinkPay, et que l'ISF attribué à ScanLinkPay à l'homologation est le même pour tous nos
   clients ? Devons-nous déclarer à la DGI la liste de nos clients ?

4. **Jeton de test.** Sur notre compte de test, comment générer le jeton d'accès à l'API e-MCF (menu à utiliser) ? Le
   compte de test comprend-il un e-MCF (NIM) déjà activé ? Quelle est la durée de validité d'un jeton et comment le
   renouveler ?

5. **Adresses de l'API de test.** La documentation de l'API indique `https://developper.dgirdc.cd/edef/api/…` ; le
   communiqué mentionne « developper.dgirep.cd ». Quelle est l'adresse exacte à utiliser ?

6. **ISF en test.** Quelle valeur d'ISF devons-nous envoyer pendant les tests, avant l'homologation ?

7. **Moyens de paiement.** Quel type de paiement (`MOBILEMONEY`, `CARTEBANCAIRE`, `AUTRE`…) faut-il utiliser pour :
   un paiement depuis un portefeuille électronique ScanLinkPay, un paiement par carte prépayée ScanLinkPay, et un
   paiement par carte bancaire Visa / Mastercard ?

8. **Taux de change.** Pour le contrôle du taux à 1 % près du taux moyen de la Banque Centrale, pouvons-nous utiliser le
   taux renvoyé par l'API d'information de l'e-MCF (`/api/info/currencyRates`) ?

9. **Groupes de taxation et types de factures.** Nous prévoyons de déclarer les groupes A, B, C, E, H, K et O et les
   types de factures FV, FA, FT, EV, EA et ET. Pouvez-vous confirmer qu'un groupe ou un type non déclaré pourra être ajouté
   plus tard par une re-homologation limitée ?

10. **Format d'impression.** Nos clients impriment sur des imprimantes thermiques de 58 et 80 mm. Ce format est-il
    accepté pour la facture normalisée, et existe-t-il une taille minimale pour le code QR ?

Nous vous remercions par avance pour votre retour et restons disponibles pour une séance de travail.

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

[Nom et fonction du représentant]
[Dénomination sociale] — [Téléphone] — [E-mail]

---

## Courrier 2 — Procédure d'homologation (à envoyer maintenant)

**À :** homologationsfe@dgirdc.cd
**Objet :** SFE « ScanLinkPay » — procédure d'homologation transitoire

Madame, Monsieur,

La société [Dénomination sociale] (NIF [NIF], RCCM [RCCM]), fournisseur du SFE **ScanLinkPay**, dispose d'un compte sur
la plateforme de test e-DEF et prépare son dossier d'homologation (e-MCF).

Nous souhaiterions connaître :
1. les conditions et les documents propres à l'**homologation transitoire** (note n° 01/292 du 15/12/2025), et s'il est
   possible de la demander d'abord, puis l'homologation complète ;
2. les **frais** éventuels et les **délais** de traitement ;
3. si les cas de test et les photos peuvent être transmis d'abord par voie électronique, avant le dépôt physique ;
4. les modalités de la **démonstration** devant la commission (en ligne ou sur place).

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

[Nom et fonction du représentant]
[Dénomination sociale] — [Téléphone] — [E-mail]

---

## Courrier 3 — Dépôt du dossier d'homologation (plus tard, avec les autres pièces du dossier : formulaire signé, RCCM, manuels…)

**À :** commissionhomologation@dgirdc.cd — et dépôt physique à la DGI, Kinshasa, avec le formulaire signé
**Objet :** Demande d'homologation du SFE « ScanLinkPay », version [version]

Monsieur le Directeur Général,

Nous avons l'honneur de soumettre à votre haute attention la demande d'homologation [transitoire / complète] du système
de facturation d'entreprise **ScanLinkPay**, version [version], connecté à l'e-MCF de la DGI.

Vous trouverez ci-joint :
- le formulaire de demande d'homologation, signé ;
- la copie du RCCM et du Crédit Mobilier, le quitus fiscal en cours de validité, le certificat d'affiliation à la CNSS
  et l'Identification Nationale ;
- le catalogue technique, le manuel d'utilisation, le manuel de contrôle et la brochure du produit ;
- le tableau de conformité rempli ;
- les cas de test réalisés avec l'e-MCF de test, en mode TTC et en mode HT (22 cas sur 29 : les 7 autres concernent des groupes de
  taxation que nous ne déclarons pas), avec les factures, les rapports X, Z et A et le tableau de vérification sur le site de la DGI ;
- l'accès aux fichiers d'installation (Android, Windows, navigateur).

Nous nous engageons à présenter une démonstration complète devant la commission, à nous mettre en conformité totale dans
un délai de trois mois, à garantir que ScanLinkPay ne peut pas émettre de facture non normalisée pour une entreprise
soumise, et à fournir gratuitement les mises à jour à nos clients.

Veuillez agréer, Monsieur le Directeur Général, l'expression de notre haute considération.

[Nom et fonction du représentant]
[Dénomination sociale] — [Adresse] — [Téléphone] — [E-mail]

---

## Courrier 4 — Transmission des résultats des cas de test (prêt à envoyer)

**À :** homologationsfe@dgirdc.cd
**Cc :** assistancesfe@dgirdc.cd
**Objet :** SFE « ScanLinkPay » — résultats des cas de test sur l'e-MCF de test (NIF A2216742Y, NID CD01005533-1)

**Pièces jointes :**
1. `Dossier-preuves-tests-DGI-20261105-1327.pdf` (43 pages) : une page par cas du document « Cas de test SFE » v1.2, avec la facture
   normalisée en mode TTC et en mode HT côte à côte, puis les rapports X, Z et A ;
2. `verification-DGI-44-factures.csv` : le résultat de la vérification des 44 factures sur le site de vérification de la DGI.

Madame, Monsieur,

La société [Dénomination sociale] (RCCM [RCCM]), fournisseur du système de facturation d'entreprise **ScanLinkPay**, a réalisé les
cas de test de l'homologation avec l'e-MCF de test de la contribuable CONGO CONSULTING ENTREPRISE (NIF **A2216742Y**, point de
vente « SCANLINKPAY CAISSE TEST 1 », NID **CD01005533-1**). Nous vous en transmettons les résultats.

**Périmètre.** Nous déclarons les groupes de taxation **A, B, C, E, H, K et O** et les types de factures **FV, FT, FA, EV, ET et EA**.
Conformément au guide d'homologation (un SFE ne peut être utilisé que pour les groupes et types validés), les 7 cas qui exigent
d'autres groupes (n° 14, 18, 20, 21, 23, 24 et 28) ne sont pas présentés. Nous avons donc réalisé **22 cas sur 29, chacun en mode TTC
et en mode HT, soit 44 factures** normalisées (campagne du 05/11/2026, factures n° 2026/000113 à 2026/000156), ainsi que les
rapports **X, Z (n° 2) et A (n° 4)**.

**Vérification.** Chacune des 44 factures a été retrouvée sur le site de vérification
(https://developper.dgirdc.cd/sygdef/verification) à partir de son code DEF/DGI et du NID. Nous avons contrôlé la concordance du
numéro, de la date et de l'heure, du total TTC, de la TVA, du mode de prix (TTC / HT), du type de client, de l'ISF, du NID et du
code DEF/DGI, et, pour les avoirs, de la nature et de la référence à la facture d'origine (ou « RRR »). Les 44 sont conformes ; le
détail figure dans le fichier joint.

**Éléments à signaler.**
- L'ISF utilisé pendant les tests est un identifiant de test (`SLP-SFE-01`) ; nous attendons l'ISF définitif à l'homologation.
- Lors de nos essais préliminaires, quelques factures ont été refusées par l'e-MCF (par exemple pour la taxe spécifique, que
  l'e-MCF veut avec sa valeur par unité et qui entre dans la base de la TVA en mode TTC) : nous avons corrigé notre logiciel puis
  refait les cas. Ces essais ont consommé des numéros de la série.
- Notre rapport A affiche « 0 (non suivi) » comme quantité en stock pour les articles de test, qui ne sont pas gérés en stock.

**Questions.**
1. **Numérotation.** Les factures refusées pendant les essais restent dans notre journal (statut « abandonnée »), ce qui laisse des
   numéros inutilisés dans la série 2026. Est-ce acceptable en test et, en production, faut-il une règle particulière ?
2. **Un e-MCF par point de vente.** La demande d'e-DEF porte le nom et l'adresse d'un point de vente. Une entreprise qui exploite
   plusieurs magasins avec ScanLinkPay doit-elle demander un e-MCF (et un jeton) par magasin ?
3. **Rapport A.** La quantité en stock est-elle attendue pour tous les articles, y compris les services et les articles non suivis
   en stock ? Notre affichage « 0 (non suivi) » est-il acceptable ?
4. **Rapports X et Z.** Les ventes non normalisées (bon provisoire, facture en échec) apparaissent comme « ventes incomplètes ».
   Un Z peut-il être clôturé tant qu'il en reste ?
5. **Suite de la procédure.** Quelles pièces restent à fournir pour l'homologation transitoire, dans quels délais et avec quels
   frais, et quelles sont les modalités de la démonstration devant la commission ?

Nous restons à votre disposition pour toute précision ou démonstration.

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

[Nom et fonction du représentant]
[Dénomination sociale] — [Téléphone] — [E-mail]
