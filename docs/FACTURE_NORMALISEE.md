# Facture normalisée (DGI, RDC) — ce que disent les documents et comment l'intégrer

Résumé de ce que contiennent les documents officiels reçus le 30/10/2026 (on les résume, on ne les copie pas) :
- *Protocole e-MCF–SFE v1.3* (l'API que notre serveur appellera) ;
- *Note de service n° 01/022/DGI/DG/FACNO-TVA/FMM/2026* + annexe « Spécifications fonctionnelles et techniques des SFE » (19/02/2026) ;
- *Groupes de taxation v1.2* et *Communiqué n° 01/010* du 25/02/2026 (nouveaux taux de la loi de finances 2026) ;
- *Cas de test SFE v1.2* (le dossier d'homologation : 29 factures + 3 rapports).
Pas encore reçus : *Demande d'homologation*, *Tableaux de conformité*, *Guide de mise à jour et d'homologation*, *Protocoles SFE-MCF* (inutile pour l'e-MCF : il concerne l'appareil physique).

## Les mots
**SFE** = le logiciel de facturation de l'entreprise : c'est **ScanLinkPay** (Caisse, Ventes). **e-MCF** = le module de contrôle de la DGI, dans le nuage : notre serveur lui envoie la facture, il répond par les **éléments de sécurité** (code DEF/DGI de 29 caractères, code QR, compteurs, date/heure). **ISF** = identifiant du SFE (format `AAA-BBB-NN`), donné par la DGI **à l'homologation**, le même pour tous nos clients. **NIF** = identifiant fiscal du contribuable (9 caractères). **NIM/NID** = numéro du e-MCF du contribuable.

## L'API e-MCF (v1.3), en bref
- Adresses : production `https://edef.dgirdc.cd/api/invoice` et `/api/info` ; test `https://developper.dgirdc.cd/edef/api/invoice` et `/api/info` (le communiqué écrit « developper.dgirep.cd » : à vérifier). JSON, `Authorization: Bearer <jeton>` ; le jeton est créé par le contribuable dans le portail e-DEF (« Gérer les e-DEF ») et lié à son NIF et à son e-MCF. Sans jeton valide : 401.
- **Facturation, en deux temps** : `POST /api/invoice` envoie la facture et renvoie un `uid` + les **montants calculés par l'e-MCF** (totaux par groupe, TVA, total TTC) ; notre serveur **compare avec son propre calcul** ; puis `PUT /api/invoice/{uid}/CONFIRM` (avec `total` et `vtotal`) renvoie `dateTime`, `qrCode`, `codeDEFDGI`, `counters`, `nim` — ou `.../CANCEL` pour abandonner. Une demande non finalisée expire au bout de **2 minutes** ; **10** demandes en attente au plus par e-MCF. `GET /api/invoice/{uid}` relit une demande en attente ; `GET /api/invoice` = état (jeton valide, demandes en attente).
- **Demande** : `nif`, `rn` (numéro de facture du SFE), `mode` (`ttc` ou `ht`), `isf`, `type` (FV vente, FT acompte, FA avoir, EV/ET/EA export), `items[]` (code, type BIE/SER/TAX, nom, prix, quantité à 3 décimales, groupe A–P, taxe spécifique, prix d'origine + motif de remise), `client` (NIF, nom, contact, adresse, type PP/PM/PC/PL/AO), `operator` (nom du caissier), `payment[]` (ESPECES, VIREMENT, CARTEBANCAIRE, MOBILEMONEY, CHEQUES, CREDIT, AUTRE ; devise et taux), `reference` (code DEF/DGI de la facture d'origine, pour un avoir), `cmta…cmth` (commentaires), `curCode/curDate/curRate` (équivalent USD).
- **Information** : `/api/info/status` (e-MCF : Enregistré / Actif / Désactivé), `/taxGroups` (taux actuels A–P), `/invoiceTypes`, `/paymentTypes`, `/clientTypes`, `/referenceTypes`, `/itemTypes`, `/currencyRates`.
- ~30 codes d'erreur (annexe) : montant TTC/TVA déclaré ≠ calculé (50/51), facture déjà finalisée (20), avoir > facture d'origine (12), doublon en attente (63), serveur injoignable pour un avoir (60), etc.

## Ce que le logiciel doit faire (note de service)
- **Interdit de finaliser une facture sans les éléments de sécurité de l'e-MCF** (1.1.5). Ce qui est imprimé = ce qui a été échangé (1.1.4). Pas de facture nulle ou négative ; au moins 8 lignes de commentaire.
- **16 groupes de taxation A–P** : A exonéré / hors champ (code d'article « HORS CHAMP »), B 16 %, **C 5 %** (était 8 %), D régimes dérogatoires, E export 0 %, F 16 % marché public, **G 5 %**, H consignation, I garantie, J débours, K non-assujettis, L prélèvements, M/N TVA spécifique, **O 1 %** et **P 1 %** (nouveaux). Aucune solution ne peut être en production sans ces groupes (communiqué).
- **Calculs** : prix à 2 décimales, quantités à 3 décimales, arrondi à 2 décimales ; en TTC la TVA est extraite du total par groupe ; base imposable + taxe = total, **la taxe est arrondie vers le haut** si besoin ; mode `ttc`/`ht` écrit sur la facture.
- **Numérotation** : référence unique, série ininterrompue **par année de gestion** ; le duplicata garde le numéro (mention DUPLICATA).
- **Avoirs** (FA/EA) : nature obligatoire (COR correction, RAN annulation, RAM reprise, RRR remise/ristourne), référence = code DEF/DGI de la facture d'origine (« RRR » pour une remise générale), articles et quantités ≤ ceux de l'origine, **même prix unitaire**, plusieurs avoirs partiels possibles.
- **Client** : type obligatoire (PP, PM, PC, PL, AO) ; PM/PC/PL demandent NIF + nom ; AO demande la référence du certificat d'exonération (commentaire A, « Réf. Exo. : »).
- **Paiement en USD** : montant en USD et taux de change sur la facture ; **taux à 1 % près du taux moyen de la Banque Centrale**. Total des paiements = total de la facture.
- **Mentions sur la facture** : dénomination, NIF, adresse, contacts, client, DUPLICATA / FACTURE D'AVOIR / EXPORTATION / D'ACOMPTE, numéro, articles avec groupe, remises, totaux par groupe, taux, TVA par groupe, total TTC **en lettres**, équivalent USD, paiements, date et heure, ISF, nom de l'opérateur, **code QR et éléments de sécurité**.
- **Rapports** : X (session en cours / période), Z (clôture de période), A (par article : vendu, retourné, en stock) ; **journal électronique** de toutes les factures avec leur code DEF/DGI ; dépôts et retraits d'espèces.
- **Homologation** : produire les **29 factures de test** (cas 1 à 29 : mélanges de groupes, quantités 2,375 et 3,5, remises, taxes spécifiques, acompte, avoirs COR/RAM/RAN/RRR, export, client AO, USD, groupes O et P, « HORS CHAMP ») **en mode TTC et en mode HT**, plus les rapports X, Z, A, avec photos, et les vérifier sur le site de vérification de la DGI. Ensuite : dossier d'homologation (tableaux de conformité) ; une re-homologation limitée aux cas de test est demandée pour les groupes 2026.

## Écarts entre ScanLinkPay aujourd'hui et ces exigences
| Exigence | Aujourd'hui |
|---|---|
| NIF de l'entreprise, régime (assujetti ou non), jeton e-MCF | `legal_identifiers` (JSON, KYB) existe ; rien pour le jeton ni le régime |
| Groupe de taxation + type (BIE/SER/TAX) + code par article | Un seul taux de TVA par magasin (16 %, TTC extrait) |
| Quantités à 3 décimales (poids) | Quantités entières |
| Remises par ligne / sur le total, taxe spécifique | Pas de remise ligne à la caisse |
| Numéro de facture continu par année | Références `TK-…` / `SALE-…` / `HL-…` non conformes |
| Type de client + NIF sur la facture | Non demandé à la caisse |
| Avoirs (nature, référence, quantités) | Annulation de ticket, pas d'avoir normalisé |
| Montant en lettres, QR, éléments de sécurité, ISF | Reçu sans |
| Rapports X / Z / A, journal | Rapport de session de caisse seulement |
| Taux USD à 1 % du taux BCC | Taux indicatif du super admin, non comparé |

## Le point dur : le hors ligne
La règle 1.1.5 interdit de finaliser une facture sans les éléments de sécurité, et l'e-MCF est **dans le nuage** : sans réseau, pas de facture normalisée. Le document de test évoque un stockage temporaire dans le MCF quand le réseau manque, mais c'est le **MCF physique** (appareil à côté de la caisse). Trois pistes, **à faire trancher par la DGI par écrit** (assistancesfe@dgirdc.cd) avant de concevoir :
1. un reçu provisoire hors ligne (comme aujourd'hui, `HL-…`), normalisé dès le retour du réseau, avec un délai toléré ;
2. un MCF physique par caisse pour les magasins qui veulent vendre sans réseau (appareil à piloter, pas depuis un navigateur) ;
3. pas de vente normalisée sans réseau (les ventes hors ligne restent possibles pour les entreprises non soumises).

## Plan proposé
0. **Questions à la DGI** : le hors ligne ; l'ISF et le dossier d'homologation (frais, délais) ; un jeton de test et un e-MCF de test ; d'autres cas de remboursement ; correspondance des moyens de paiement ScanLinkPay (MOBILEMONEY ? AUTRE ?).
1. **Fondations** (base de données) : profil fiscal de l'entreprise (NIF, régime, jeton chiffré, NIM, activation par entreprise), groupe + type + code par article, quantités décimales, numérotation annuelle, table des factures normalisées (uid, codes, QR, compteurs, instantané JSON), journal.
2. **Service e-MCF** (serveur NestJS, jamais le navigateur : le jeton est secret) : état, groupes de taxation, demande → vérification des montants avec notre propre calcul → confirmation / annulation ; reprise des demandes en attente après une panne (2 minutes) ; tests contre un faux serveur écrit d'après le protocole.
3. **Écrans** : paramètres fiscaux, groupe par produit, type de client, remises, impression avec toutes les mentions + QR + montant en lettres, duplicata, avoirs.
4. **Rapports X / Z / A**, puis les 29 cas de test en TTC et HT, puis le dossier d'homologation.
5. **Hors ligne**, selon la réponse de la DGI.
Rien de tout cela n'est codé à ce jour ; le service reste « désactivé par entreprise » tant que l'homologation n'est pas obtenue.

## Sécurité et secrets
Le jeton e-MCF d'un client est un secret : chiffré en base, jamais renvoyé au navigateur, jamais dans un message ni dans le dépôt (comme `FLEXPAIE_TOKEN`). Les adresses de production et de test vont dans des variables d'environnement.
