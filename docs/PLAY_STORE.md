# Publier ScanLinkPay sur le Google Play Store

Préparé le 22/10/2026. Le compte développeur doit être un compte **Organisation** (application financière). Il faut donc un
numéro D-U-N-S. Voir la réponse dans la conversation du 22/10.

## 1. Adresses à donner à Google

| Champ de la Play Console | Adresse |
|---|---|
| Politique de confidentialité | `https://<site ScanLinkPay>/confidentialite` |
| Suppression du compte (« Data deletion ») | `https://<site ScanLinkPay>/supprimer-mon-compte` |

`<site ScanLinkPay>` est l'adresse du site sur Render, la même que `VITE_PUBLIC_WEB_URL`.

- Sans `VITE_PUBLIC_WEB_URL` dans le build Android, le bouton « Supprimer mon compte » ouvre la page dans l'application au lieu du
  navigateur. Ça marche quand même, mais le build du Play Store doit avoir cette variable.
- **Suppression** : un client, un marchand ou le patron d'une entreprise.
  - Jamais un employé (vendeur/caissier, gérant…) ni un administrateur.
  - Refusée tant qu'il reste de l'argent (solde, épargne, retrait en cours, tontine) ou une équipe.
  - Voir migration 082 et `linkpay-api/src/users/account-deletion.service.ts`.

## 2. Formulaire « Sécurité des données » (Data safety)

Réponses tirées du code au 22/10/2026 : permissions Android, tables, prestataires. Si une fonction se met à collecter autre chose,
mettre à jour ce tableau **et** la page `/confidentialite`.

**Questions générales**
- L'application collecte-t-elle des données ? **Oui**.
- Données chiffrées en transit ? **Oui** (HTTPS partout).
- Les utilisateurs peuvent-ils demander la suppression ? **Oui** : l'adresse de suppression ci-dessus.
- Données partagées avec des tiers ? **Non**. Selon les définitions de Google, l'envoi à un prestataire qui agit pour nous ne compte
  pas comme un partage :
  - FlexPaie pour les paiements ;
  - Supabase et Render pour l'hébergement ;
  - Google Firebase pour les notifications.
  Ce que voit le destinataire d'un paiement (nom, numéro de portefeuille) est un transfert demandé par l'utilisateur : ce n'est pas
  un partage non plus.

**Données collectées** (toutes « traitées de façon éphémère » = **non**)

| Catégorie Google | Type | Obligatoire ? | Finalités à cocher |
|---|---|---|---|
| Informations personnelles | Nom | Obligatoire | Fonctionnement de l'application, Gestion du compte, Prévention des fraudes et sécurité |
| Informations personnelles | Adresse e-mail | Facultatif | Fonctionnement, Gestion du compte |
| Informations personnelles | Numéro de téléphone | Obligatoire | Fonctionnement, Gestion du compte, Prévention des fraudes et sécurité |
| Informations personnelles | ID utilisateur (numéro de portefeuille) | Obligatoire | Fonctionnement, Gestion du compte |
| Informations personnelles | Adresse | Facultatif (marchands et entreprises) | Fonctionnement |
| Informations personnelles | Autres infos (RCCM, identification nationale, représentant légal) | Facultatif (entreprises) | Fonctionnement, Prévention des fraudes et conformité |
| Informations financières | Informations de paiement de l'utilisateur (numéros Mobile Money) | Facultatif | Fonctionnement |
| Informations financières | Historique des achats (paiements, ventes) | Obligatoire | Fonctionnement |
| Informations financières | Autres infos financières (solde, transferts, retraits, épargne, tontines, dépenses notées) | Obligatoire | Fonctionnement, Prévention des fraudes et conformité |
| Activité dans les applications | Autres contenus générés par l'utilisateur (« Mes dépenses ») | Facultatif | Fonctionnement |
| Appareil ou autres identifiants | ID d'appareil (appareil connecté, jeton de notification) | Obligatoire | Fonctionnement, Prévention des fraudes et sécurité |

**À ne pas cocher** :
- **Localisation**. Sur Android 10 et moins, la permission ne sert qu'au balayage Bluetooth de l'imprimante ; aucune position n'est
  lue ni envoyée.
- **Photos et vidéos**. L'appareil photo lit les QR codes et codes-barres, rien n'est enregistré.
- **Contacts**.
- **Fichiers**.
- **Audio**.
- **Santé**.
- **Messages**.
- **Historique de navigation**.
- **Infos et performances de l'application** (aucun outil de suivi d'erreurs ni de statistiques n'est installé).

## 3. Autres formulaires de la Play Console

- **Fonctions financières** : portefeuille numérique, paiements mobiles, transferts d'argent (de pair à pair, en RDC). Google peut
  demander les autorisations de la société : préparer RCCM, identification nationale et tout agrément financier.
- **Public cible** : 18 ans et plus.
- **Publicité** : aucune.
- **Classification du contenu** : questionnaire, catégorie « Finance / utilitaire », sans contenu sensible.
- **Accès aux fonctions pour la vérification de Google** : un compte de test client avec du solde de test, son mot de passe, son
  code d'accès (6 chiffres) et son code PIN (4 chiffres). Sans ces codes, le vérificateur reste bloqué sur l'écran de verrouillage.
  - Utiliser la base **LinkPay Test**, jamais un vrai client.

⚠️ **Point de vigilance « Paiements Google Play ».** L'application vend deux choses numériques payées dans l'application :
- l'**abonnement des entreprises** ;
- le **mode Pro de « Mes dépenses »**.

La règle de Google exige normalement le système de facturation de Google Play pour un service numérique acheté dans une application.
Si Google refuse la version, la solution habituelle est de faire payer ces deux abonnements sur le site plutôt que dans
l'application. Les paiements entre personnes et chez les commerçants (biens réels) ne sont pas concernés.

## 4. Construire le fichier AAB signé

**Une seule fois : créer la clé d'envoi (upload key).** Sur l'ordinateur qui construit, avec le JDK :

```
keytool -genkeypair -v -keystore C:/Cles/scanlinkpay-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

- Garder le fichier `.jks` **hors du dossier du projet**, avec une copie de sauvegarde et ses mots de passe dans un coffre.
- Ne jamais les mettre dans le dépôt ni dans une conversation.
- Dans la Play Console, laisser **Play App Signing** activé : Google garde la clé de signature finale, notre clé ne sert qu'à envoyer.
  Une clé d'envoi perdue se remplace en écrivant au support de Google ; la clé de Google ne se perd pas.

**Une seule fois : dire au build où est la clé.**
1. Copier `linkpay-web/android/keystore.properties.example` en `linkpay-web/android/keystore.properties`. Ce fichier est ignoré par Git.
2. Le remplir : chemin du `.jks`, mots de passe, alias `upload`.
3. Sur un serveur de build, utiliser plutôt les variables `SLP_UPLOAD_STORE_FILE`, `SLP_UPLOAD_STORE_PASSWORD`,
   `SLP_UPLOAD_KEY_ALIAS` et `SLP_UPLOAD_KEY_PASSWORD`.

**À chaque version.**

```
cd linkpay-web
# .env.production : VITE_API_URL (API Render), VITE_PUBLIC_WEB_URL (site Render), Supabase de PRODUCTION
npm run build
npx cap sync android
cd android
set SLP_VERSION_CODE=1        # 2, 3, 4… : toujours plus grand que la version précédente envoyée
set SLP_VERSION_NAME=1.0.0
gradlew bundleRelease
```

- Le fichier obtenu est `linkpay-web/android/app/build/outputs/bundle/release/app-release.aab`. C'est lui qu'on envoie dans la Play
  Console, d'abord en **test interne**.
- `google-services.json` (Firebase, pour les notifications) doit être dans `linkpay-web/android/app/` sur l'ordinateur qui construit.
- La configuration de signature n'a pas pu être compilée dans l'environnement de préparation (pas de SDK Android). Vérifiez le
  premier `gradlew bundleRelease`, puis
  `jarsigner -verify -verbose app/build/outputs/bundle/release/app-release.aab`.
- Les téléphones qui ont installé un ancien APK à la main (signé avec une autre clé) devront le désinstaller avant d'installer la
  version du Play Store.

## 5. Captures et visuels à préparer

**Visuels obligatoires**
- Icône 512 × 512 PNG : le logo actuel, sur fond plein.
- Bannière 1024 × 500 JPG ou PNG, sans texte important dans les bords. Par exemple « Payez, recevez, encaissez — en CDF et en USD »
  à côté d'un téléphone qui montre l'accueil.

**Captures de téléphone**
- De 2 à 8, au format portrait 9:16, par exemple 1080 × 1920.
- À faire sur la base **LinkPay Test**, avec des comptes et des montants fictifs, jamais de vrais noms ni de vrais numéros.
- En mode clair, la batterie et l'heure propres.

| # | Écran | Ce qu'on doit voir |
|---|---|---|
| 1 | Accueil client | Solde CDF/USD, boutons Envoyer / Recevoir / Payer, dernières opérations |
| 2 | Payer par QR | Le scanner ouvert, ou la confirmation d'un paiement chez un commerçant |
| 3 | Envoyer | Le montant et le destinataire, juste avant le code PIN |
| 4 | Recharger / Retirer | Le choix Mobile Money (M-Pesa, Orange, Airtel, Africell) |
| 5 | Mes dépenses | Le camembert des dépenses du mois |
| 6 | Caisse du supermarché | Le panier, le total et l'encaissement (compte marchand) |
| 7 | Ventes électronique | La facture A4 ou le ticket |
| 8 | Épargne ou tontine | L'objectif d'épargne, ou le tour de tontine |

**Facultatif**
- Captures de tablette 7" et 10", si l'application est déclarée pour tablettes. Les mêmes écrans vont bien.

**Textes de la fiche**
- Nom : « ScanLinkPay ».
- Description courte : 80 caractères au plus.
- Description longue : 4000 caractères au plus.
- À écrire en français. Je peux les rédiger sur demande.
