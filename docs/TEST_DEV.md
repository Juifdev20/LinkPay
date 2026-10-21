# Guide de test pour les développeurs

**Règle fondamentale : l'application ne crée jamais d'argent.**
Il n'y a plus de prestataire simulé (`mock`). Tout l'argent de test s'écrit manuellement
dans la base **LinkPay Test** via l'éditeur SQL de Supabase. La production n'est jamais touchée.

---

## 1. Les deux environnements

| | **Local (test)** | **Production** |
|---|---|---|
| API | `http://localhost:3000` | `https://linkpayapi.onrender.com` |
| Base Supabase | LinkPay Test | LinkPay |
| Argent | fictif (`credit_test_money`) | réel (FlexPaie) |
| Retraits | bloqués | réels |
| Build Android | `build:android:local` | `build:android` |

---

## 2. Lancer l'environnement local

### API (linkpay-api)
```bash
cd linkpay-api
npm ci              # première fois seulement
npm run start:dev   # démarre sur http://localhost:3000
```
Au démarrage, vérifier ce message dans les logs :
```
[PspFactory] Database: test — real payments are refused, test money only
```
Si ce message n'apparaît pas, la base n'est pas LinkPay Test — vérifier `linkpay-api/.env`.

### Web (linkpay-web)
```bash
cd linkpay-web
npm ci              # première fois seulement
npm run dev         # démarre sur http://localhost:5173
```

---

## 3. Créditer un compte de test

Dans Supabase → projet **LinkPay Test** → **SQL Editor** → New query :

```sql
-- Créditer en CDF
SELECT credit_test_money('0810000001', 50000, 'CDF');

-- Créditer en USD
SELECT credit_test_money('0810000001', 100, 'USD');

-- Reprendre tout l'argent de test (remettre à zéro)
SELECT remove_test_money('0810000001', 'CDF');
SELECT remove_test_money('0810000001', 'USD');
```

Le numéro peut être écrit sous toutes les formes : `+243 81 000 00 01`, `0810000001`, `243810000001`.
Le compte doit déjà exister (s'inscrire une fois dans l'app locale).

---

## 4. Premier administrateur sur LinkPay Test

Après s'être inscrit dans l'app locale, exécuter dans le SQL Editor de **LinkPay Test** :

```sql
INSERT INTO user_roles (user_id, role_id)
SELECT p.id, r.id FROM profiles p, roles r
 WHERE regexp_replace(p.phone, '\D', '', 'g') = '243810000001' AND r.slug = 'super_admin'
ON CONFLICT DO NOTHING;
```
Remplacer `243810000001` par ton vrai numéro (format international sans le `+`).

---

## 5. Tester sur le téléphone Android (environnement local)

Ce build fait parler l'app Android à l'API locale via un tunnel USB.

```bash
# 1. Brancher le téléphone en USB avec le débogage USB activé
#    Puis ouvrir un tunnel : port 3000 du téléphone → port 3000 du PC
adb reverse tcp:3000 tcp:3000

# 2. Compiler pour Android local
cd linkpay-web
npm run build:android:local

# 3. Synchroniser et compiler l'APK
npx cap sync android
cd android

# Sur Windows, avec JAVA_HOME pointant sur JDK 21 :
export JAVA_HOME="/c/Program Files/Java/jdk-21.0.12.1"
export PATH="$JAVA_HOME/bin:$PATH"
bash gradlew assembleDebug

# 4. Installer sur le téléphone
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

L'APK pointe sur `http://localhost:3000` (API locale, base LinkPay Test).
Créditer le compte comme décrit à l'étape 3.

---

## 6. Ce que l'argent de test peut et ne peut pas faire

| Opération | Autorisation |
|---|---|
| Transférer vers un autre portefeuille de test | ✅ oui |
| Payer un marchand de test | ✅ oui |
| Payer un abonnement, une carte, Expense Pro | ✅ oui |
| **Retirer** (Mobile Money ou banque) | ❌ jamais |
| Transférer vers un vrai portefeuille | ❌ jamais |
| Payer un vrai marchand | ❌ jamais |

Ces règles sont vérifiées à la fois par l'API et par la base (déclencheurs) :
aucun chemin dans le code ne peut les contourner.

---

## 7. Ce qui ne se teste QU'en production

FlexPaie n'a pas de bac à sable. Les opérations suivantes se testent sur la production
avec de **vrais petits montants** (100 CDF minimum) sur un **vrai compte** (jamais un portefeuille de test) :

- Recharge Mobile Money
- Recharge par carte bancaire
- Retrait Mobile Money

Voir `docs/FLEXPAIE.md` pour les détails.

---

## 8. Nouvelle migration

1. Écrire la migration dans `linkpay-api/supabase/migrations/` (numéro suivant : 072, 073…)
2. L'exécuter **d'abord sur LinkPay Test** (SQL Editor) et vérifier l'app
3. Puis sur la production au moment du déploiement Render
4. Régénérer le fichier de construction :
   ```bash
   cd linkpay-api
   node supabase/construire-base-test.js
   ```
5. Commiter `supabase/base_test.sql` avec la migration
