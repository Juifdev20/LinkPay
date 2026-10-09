# Appareil « rooté » et intégrité de l'application Android

## Ce que ça fait
Au lancement (et au plus toutes les 6 heures), l'application demande à **Google Play Integrity** de garantir deux choses :
- **l'application** : c'est bien notre version, signée par nous, non modifiée, installée depuis Google Play ;
- **l'appareil** : certifié par Google (pas rooté, pas un émulateur, pas de chargeur d'amorçage déverrouillé avec ROM
  non officielle).

Le verdict est vérifié **par l'API auprès de Google** (jamais par le téléphone) et enregistré (`device_attestations`).
L'application lance aussi ses propres détections de root (binaire `su`, Magisk, KernelSU, build « test-keys »,
partition système en écriture, Frida/Xposed…). Ces détections locales sont **indicatives** : un téléphone rooté peut
s'y cacher. Elles ne peuvent qu'**ajouter** de la méfiance côté serveur, jamais en retirer.

## Les trois modes (`DEVICE_INTEGRITY_MODE`)
| Mode | Effet |
| --- | --- |
| `off` (défaut) | Les verdicts sont enregistrés s'ils sont envoyés. Rien n'est jamais bloqué. |
| `warn` | + une alerte « Appareil non sécurisé détecté » aux super admins (cloche, push, email, SMS selon la gravité). Rien n'est bloqué. |
| `enforce` | Un **transfert** ou un **retrait** depuis une session ouverte dans l'application Android exige un verdict **fiable de moins de 24 h**. Appareil non fiable → refus (`DEVICE_UNTRUSTED`) avec message clair. Pas de verdict récent → l'application en demande un toute seule et recommence. |

La règle suit la **session** (la plateforme est enregistrée à la connexion), pas seulement un en-tête : un jeton volé sur
un téléphone Android reste une session Android même rejoué depuis un ordinateur. Le web, le bureau et les
administrateurs ne sont pas concernés.

**Procédure conseillée : `off` → `warn` (une à deux semaines, regarder les alertes, corriger les faux positifs) → `enforce`.**

## Ce que ça ne fait pas
- Cela n'empêche pas quelqu'un d'appeler l'API depuis un **ordinateur** avec des identifiants volés : c'est le rôle du PIN, du
  code d'accès, des plafonds et du moteur de risque.
- Une application distribuée **hors Google Play** (APK direct) n'est pas « reconnue » par Google : mettre
  `INTEGRITY_REQUIRE_PLAY_RECOGNIZED=false` (protection moindre) ou distribuer via Google Play (recommandé).
- Un téléphone sans services Google (certains téléphones chinois, Huawei récents) ne peut pas produire de verdict : en
  `enforce`, il ne pourrait plus envoyer d'argent. À vérifier sur votre parc avant d'activer.

## Mise en place (Google, une seule fois)
1. **Play Console** → votre application → *Protection de l'application* (App integrity) → *API Play Integrity* → lier un projet
   **Google Cloud** (ou en créer un). Noter son **numéro de projet** → `VITE_PLAY_CLOUD_PROJECT_NUMBER` (côté site web / build Android).
2. Dans ce projet Cloud : activer l'API **Play Integrity**.
3. Créer un **compte de service** (IAM) ; lui permettre de décoder les jetons (rôle sans autre droit) ; créer une clé JSON.
   Côté API : `PLAY_INTEGRITY_CLIENT_EMAIL` = `client_email`, `PLAY_INTEGRITY_PRIVATE_KEY` = `private_key` (jamais dans Git).
4. `ANDROID_CERT_SHA256` : empreinte SHA-256 du certificat de **signature de l'application** (Play Console → Intégrité de
   l'application, ou `keytool -list -v`). Plusieurs, séparées par des virgules (clé d'envoi et clé de signature Play).
5. Appliquer la migration `054`.
6. Reconstruire l'application Android (`npx cap sync android`, puis Android Studio) : le code natif est
   `DeviceIntegrityPlugin.java` + `RootDetector.java` (tests : `RootDetectorTest.java`).

## Quota
Google offre 10 000 vérifications par jour. L'application en fait au plus une toutes les 6 heures et par appareil, et l'API
limite chaque compte (20 défis et 10 vérifications par minute).

## À tester sur de vrais téléphones (non vérifié ici)
Le code natif **compile** et la logique de détection est testée sur ordinateur, mais l'API Play Integrity elle-même ne
peut s'essayer que sur un appareil avec Google Play. Avant de passer en `enforce`, tester sur : un téléphone normal
(doit être « fiable »), un téléphone rooté ou un émulateur (doit être « non fiable »), un APK installé à la main (non reconnu).
