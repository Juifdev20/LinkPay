# Tester l'app sur un téléphone avec le backend en local

Ce guide explique comment installer ScanLinkPay sur un téléphone Android et le faire parler à un backend qui tourne sur votre PC — sans passer par Render. Utile pour tester une correction tout de suite, sans attendre (ou déclencher) un déploiement.

**Important à savoir avant de commencer** : le backend local utilise **la même base Supabase que la production**. Ce n'est pas un environnement de test isolé — les comptes que vous créez, les paiements, les tontines, etc. sont les mêmes données que celles vues en production. Testez avec des comptes de test dédiés, pas avec de vrais comptes utilisateurs.

## Prérequis

- Node.js et npm installés.
- JDK 21 (obligatoire pour Capacitor 8 — pas une version plus récente ou plus ancienne).
- Android SDK + la commande `adb` accessible dans le terminal.
- Un téléphone Android avec le **débogage USB activé** (Paramètres → Options pour développeurs), branché en USB, et l'autorisation de débogage acceptée sur l'écran du téléphone.
- Le dépôt cloné.
- **Le fichier `linkpay-api/.env`** — il contient les vrais secrets (Supabase, JWT, Firebase, CinetPay, VAPID). Il n'est **pas** dans git (volontairement). Demandez-le directement à Dieudonné, par un canal privé — jamais par email ou un chat non chiffré.

## Étapes

### 1. Installer les dépendances

```bash
cd linkpay-api && npm install
cd ../linkpay-web && npm install
```

### 2. Placer le fichier `.env`

Copiez le `.env` reçu dans `linkpay-api/.env` (à la racine de `linkpay-api`, à côté de `.env.example`).

### 3. Démarrer le backend en local

```bash
cd linkpay-api
npm run start:dev
```

Laissez ce terminal ouvert — il recompile et redémarre automatiquement à chaque modification du code backend. Vous devez voir en bas des logs : `ScanLinkPay API running on port 3000`.

### 4. Vérifier que le téléphone est bien reconnu

Dans un autre terminal :

```bash
adb devices
```

Le téléphone doit apparaître avec le statut `device` (pas `unauthorized` — dans ce cas, acceptez la popup sur le téléphone).

### 5. Rediriger le téléphone vers le backend local

```bash
adb reverse tcp:3000 tcp:3000
```

Cette commande fait passer les appels `http://localhost:3000` du téléphone à travers le câble USB, jusqu'au `localhost:3000` de votre PC. **Elle doit être relancée à chaque fois que le câble est débranché/rebranché** ou que `adb` redémarre — sinon l'app affichera une erreur de connexion générique (le téléphone ne peut simplement plus joindre le backend).

### 6. Builder et installer l'app en mode "backend local"

```bash
cd linkpay-web
npm run build:android:local
npx cap sync android
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.linkpay.app/.MainActivity
```

(Sous Windows sans Git Bash, remplacez `./gradlew` par `gradlew.bat`.)

L'app se lance sur le téléphone, connectée à votre backend local.

## Revenir au mode normal (backend Render)

Pour tester contre la vraie API en ligne (ce qui est réellement déployé), refaites l'étape 6 avec le script habituel à la place :

```bash
npm run build:android
```

(pas besoin de `adb reverse` ni de backend local dans ce cas — `build:android` pointe directement vers `https://linkpayapi.onrender.com`).

## En cas de problème

- **"Échec de connexion" générique dans l'app** → le tunnel `adb reverse` a probablement sauté. Relancez `adb reverse tcp:3000 tcp:3000`.
- **"Ce compte est déjà connecté sur un autre appareil"** → normal si le compte a été créé/testé via un script ou un autre appareil sans `device_id` cohérent. Un admin doit réinitialiser sa session (`POST /api/v1/admin/users/:userId/reset-session`, ou directement en SQL : `UPDATE profiles SET active_session_id = NULL, active_device_id = NULL WHERE id = '...'`).
- **Le backend local ne démarre pas** → vérifiez que `linkpay-api/.env` est bien présent et complet (comparez avec `.env.example`).
