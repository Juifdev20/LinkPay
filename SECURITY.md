# Sécurité de ScanLinkPay

Ce document décrit les défenses en place et ce qu'il reste à faire. Il est tenu à jour avec le code.

## Défenses en place

### Base de données (Supabase)
- Seul le serveur API (clé `service_role`) peut exécuter les fonctions SQL qui déplacent de l'argent (`043`).
- Plus aucune écriture directe sur les tables depuis le navigateur (`044`).
- Colonnes secrètes (PIN, 2FA, mot de passe du stock) invisibles pour l'API REST publique (`045`).
- Mouvements d'argent atomiques, idempotents, avec verrous de lignes (portefeuilles, remboursements, retraits, tontines, caisse).
- Les soldes se déduisent du grand livre (`ledger_entries`), jamais d'un compteur modifiable.

### API (NestJS)
- `helmet`, CORS restreint, validation stricte des entrées (`whitelist` + `forbidNonWhitelisted`).
- Limites de débit : 100 requêtes/min/IP par défaut ; plus strictes sur l'inscription (5 / 10 min), la connexion (10 / min), le rafraîchissement, le changement de mot de passe et le déverrouillage WebAuthn.
- Verrouillage par compte : 5 mots de passe faux en 15 min → connexion bloquée 15 min (`LoginAttemptsService`).
- PIN de transaction haché, bloqué après 5 essais.
- Une seule session active par compte (hors admins).
- Contrôle des sorties d'argent (`RiskService.assessOutflow`) : trop d'opérations en une heure, envoi à trop de portefeuilles différents en 10 minutes, gros montant depuis un portefeuille de moins de 24 h → blocage et entrée dans `risk_logs`. Les très gros montants sont seulement signalés. Les admins consultent la liste via `GET /risk-logs`.
- **Accès administrateur** : un compte `admin` / `super_admin` ne fonctionne qu'avec le mot de passe **et** un code d'application d'authentification (TOTP, secret chiffré en base, code utilisable une seule fois, codes de secours hachés). Sans 2FA configurée, la session ne peut que configurer la 2FA (`JwtAuthGuard`). Jetons de rafraîchissement admin limités à 12 h. Liste d'IP autorisées optionnelle (`ADMIN_ALLOWED_IPS`).
- **Confirmation des actions sensibles** : changer un rôle, une commission, les frais/limites, les réglages de la plateforme ou réinitialiser la 2FA d'un collègue demande un code frais (`x-otp-code`, `OtpStepUpGuard`) ; impossible de changer son propre rôle ou de retirer le dernier super administrateur.
- **Alertes aux administrateurs** (cloche + notification push) : connexion admin, code 2FA faux, compte verrouillé, réseau admin non autorisé, opération bloquée par le moteur de risque, faux webhook de paiement, changement de rôle / commission / limites, réinitialisation de la 2FA, **portefeuille en négatif** (contrôle du grand livre toutes les 10 minutes).
- Limites et frais de portefeuille configurables (`wallet_limits`).
- Webhooks PSP signés, rejouables sans effet, fournisseur vérifié.
- Journal d'audit (`audit_logs`) sur les actions sensibles.
- Documentation Swagger désactivée en production (`ENABLE_SWAGGER=true` pour la réactiver).

### Web / PWA
- Politique de contenu (CSP) : scripts uniquement depuis notre origine, pas de `eval`, pas d'iframe, pas de plugin (`render.yaml`).
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.
- Aucun `dangerouslySetInnerHTML` dans le code.

### Desktop (Electron) et Android
- Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, navigation externe bloquée, pas de `<webview>`, permissions limitées à la caméra et aux notifications depuis notre propre site, pont natif réservé à notre origine.
- Android : sauvegarde automatique désactivée (`allowBackup=false`), HTTP en clair autorisé seulement vers localhost.

### Chaîne de développement
- CI (`.github/workflows/security.yml`) : tests, vérification des types, audit des dépendances, détection de secrets.
- Dependabot pour les mises à jour de dépendances.

## À faire (priorité décroissante)

1. **Appliquer les migrations `040` à `048`**, puis lancer `linkpay-api/supabase/verify_security.sql` (voir `docs/LAUNCH_CHECKLIST.md`) dans le SQL Editor de Supabase, dans l'ordre, puis lancer le *Security Advisor* de Supabase.
2. **Changer toutes les clés déjà partagées** : `service_role` Supabase, `JWT_SECRET`, mot de passe CinetPay, clé FCM.
3. Vérifier `ledger_entries` (types `ADJUSTMENT` et `TOPUP`) pour détecter un éventuel abus avant la migration `043`.
4. Fermer ou contrôler l'inscription publique de Supabase Auth (l'inscription doit passer par `/auth/register`).
5. **Jetons de session** : ils sont dans `localStorage`. Un cookie `HttpOnly` serait plus sûr contre le vol par XSS, mais il change tout le flux de connexion (web, Electron, Android) ; la CSP réduit déjà le risque. À planifier séparément.
6. **Mises à jour majeures de NestJS** : `npm audit` signale encore des vulnérabilités qui n'ont de correctif que dans une version majeure (`@nestjs/platform-express`/`multer`, `@nestjs/swagger`, `@nestjs/cli`). À faire dans une branche dédiée, avec les tests.
7. **Plusieurs instances de l'API** : le verrouillage de connexion est en mémoire ; il faudra Redis (ou une table) avant de passer à plus d'une instance.
8. **Mobile** : détection de téléphone « rooté », vérification d'intégrité de l'application (Play Integrity), épinglage de certificat — nécessitent des plugins natifs et un test sur appareil.
9. **Alertes par email / SMS** en plus de la cloche et du push, pour qu'une alerte critique réveille même si personne n'ouvre l'application.
10. **Test d'intrusion** par un tiers avant la mise en production, et sauvegardes Supabase (avec un test de restauration).

## Signaler une faille

Écrire au responsable du projet. Ne pas publier la faille avant correction.
