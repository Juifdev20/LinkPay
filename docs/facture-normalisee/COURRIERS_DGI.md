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
   types de factures FV, FA, FT, EV et EA. Pouvez-vous confirmer qu'un groupe ou un type non déclaré pourra être ajouté
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

## Courrier 3 — Dépôt du dossier d'homologation (plus tard, quand les 29 cas de test seront validés)

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
- les 29 cas de test réalisés avec l'e-MCF de test, en mode TTC et en mode HT, avec leurs photos et les rapports X, Z et A ;
- l'accès aux fichiers d'installation (Android, Windows, navigateur).

Nous nous engageons à présenter une démonstration complète devant la commission, à nous mettre en conformité totale dans
un délai de trois mois, à garantir que ScanLinkPay ne peut pas émettre de facture non normalisée pour une entreprise
soumise, et à fournir gratuitement les mises à jour à nos clients.

Veuillez agréer, Monsieur le Directeur Général, l'expression de notre haute considération.

[Nom et fonction du représentant]
[Dénomination sociale] — [Adresse] — [Téléphone] — [E-mail]
