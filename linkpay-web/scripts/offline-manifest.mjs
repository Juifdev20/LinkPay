/**
 * Hors ligne : chaque fichier de l'application qui ÉCRIT sur le serveur (api.post / put / patch / delete) est déclaré ici,
 * avec ce qui se passe quand il n'y a pas de réseau. `npm run check:offline` (lancé avant chaque build et par la CI)
 * échoue si un fichier qui écrit n'est pas déclaré : une nouvelle fonctionnalité oblige à répondre à la question
 * « et sans réseau ? ». La marche à suivre : `docs/HORS_LIGNE.md`.
 *
 *  - 'offline' : tout ce que le fichier écrit marche sans réseau (file d'attente `enqueue`, envoi au retour du réseau).
 *  - 'partial' : une partie marche sans réseau (`enqueue`), le reste demande le réseau — dire laquelle.
 *  - 'online'  : demande le réseau, et on dit pourquoi. L'utilisateur est prévenu (RequireOnline sur l'écran, ou le
 *                message général « cette action a besoin d'Internet » de lib/api.ts).
 */
const MONEY = "Déplace de l'argent ScanLinkPay : seul le serveur connaît le vrai solde, rien ne part sans lui.";
const SECURITY = "Sécurité du compte (codes, double authentification, appareils) : doit être validé par le serveur.";
const ADMIN = "Administration : décisions prises en ligne, jamais en différé.";
const SETUP = "Paramétrage (produits, personnel, magasins, réglages) : se fait en ligne ; la caisse garde le catalogue connu.";
const PREFS = "Préférence ou lecture de notification : sans conséquence si elle attend, redemandée au retour du réseau.";
const ACCOUNT = "Création ou changement de compte : validé par le serveur.";
const SYSTEM = "Mécanisme interne (session, notifications push, vérification de l'appareil) : tente seul de se refaire au retour du réseau.";

const online = (why) => ({ mode: 'online', why });
const partial = (offline, why) => ({ mode: 'partial', offline, why });

export default {
  // ---- Sans réseau : ventes, stock, caisse, dépenses (voir lib/outbox-handlers.ts)
  'components/stock/StockItemDetailDialog.tsx': { mode: 'offline', offline: 'Entrée, sortie et ajustement de stock' },
  'pages/pos/PosTill.tsx': partial('Vente en espèces, reprise d\'un ticket ouvert', "Mettre un ticket en attente, annuler une ligne, paiement ScanLinkPay / carte : demandent le serveur."),
  'pages/pos/PosPanels.tsx': partial('Entrée / sortie d\'espèces du tiroir', 'Clôturer la caisse, réglages de TVA, annuler un ticket en attente : en ligne.'),
  'pages/organization/Sales.tsx': partial('Vente en espèces (module Ventes), encaissement espèces d\'une vente créée', 'Paiement ScanLinkPay, annulation d\'une vente : en ligne.'),
  'pages/organization/Inventory.tsx': partial('Quantités comptées', 'Démarrer et valider un inventaire : en ligne.'),
  'pages/organization/Restock.tsx': partial('Écrire une demande d\'achat', 'Changer l\'état d\'une demande (approuver, refuser) : en ligne.'),
  'pages/expense-tracker/ExpenseTracker.tsx': partial('Noter une dépense dans le carnet', 'Ouvrir et clôturer une page du carnet : en ligne.'),

  // ---- En ligne : argent
  'pages/wallet/Send.tsx': online(MONEY),
  'pages/wallet/Topup.tsx': online(MONEY),
  'pages/wallet/Withdraw.tsx': online(MONEY),
  'pages/wallet/Pay.tsx': online(MONEY),
  'pages/wallet/Exchange.tsx': online("Bureau d'échange : le taux garanti 60 secondes vient du serveur et l'échange touche deux soldes à la fois."),
  'pages/wallet/SavingsPot.tsx': online(MONEY),
  'pages/wallet/MyCard.tsx': online(MONEY),
  'pages/client/tontines/CreateTontine.tsx': online(MONEY),
  'pages/client/tontines/TontineDetail.tsx': online(MONEY),
  'pages/client/tontines/TontineSettings.tsx': online(MONEY),
  'pages/merchant/ChargeCard.tsx': online(MONEY),
  'pages/merchant/CreatePaymentRequest.tsx': online(MONEY),
  'pages/merchant/Transactions.tsx': online(MONEY),
  'components/card/CardChargePrompt.tsx': online(MONEY),
  'pages/pos/PosPayment.tsx': online("Paiement d'un ticket (ScanLinkPay, carte) : demande le serveur ; l'espèces hors ligne passe par PosTill."),
  'pages/public/PaymentLinkPage.tsx': online(MONEY),
  'pages/public/PayByNumber.tsx': online(MONEY),
  'pages/organization/Subscription.tsx': online(MONEY),
  'pages/expense-tracker/ExpenseProUpgrade.tsx': online(MONEY),
  'pages/expense-tracker/ExpensePlanSelection.tsx': online('Choix d\'une formule payante : validé par le serveur.'),
  'pages/organization/SupplierOrders.tsx': online('Commande à un fournisseur : engage un tiers, confirmée par le serveur.'),
  'pages/organization/SupplierSpace.tsx': online('Espace fournisseur (catalogue, commandes) : engage un tiers, confirmé par le serveur.'),
  'components/supplier/OrderCard.tsx': online('Réponse à une commande fournisseur : engage un tiers.'),
  'pages/organization/SalesHistory.tsx': online('Archiver une vente (mot de passe du stock) : contrôlé par le serveur.'),

  // ---- En ligne : sécurité et compte
  'components/AccessCodeSettings.tsx': online(SECURITY),
  'components/AppLockGate.tsx': online("Déverrouillage : sans réseau, le code est comparé sur l'appareil (lib/offline-code.ts) ; le serveur reprend la main au retour du réseau."),
  'components/ForcePasswordChangeGate.tsx': online(SECURITY),
  'components/RecoveryCodeSettings.tsx': online(SECURITY),
  'pages/wallet/SetPin.tsx': online(SECURITY),
  'pages/auth/AdminTwoFactorSetup.tsx': online(SECURITY),
  'pages/auth/ForgotPasswordPage.tsx': online(ACCOUNT),
  'pages/auth/ResetPasswordPage.tsx': online(ACCOUNT),
  'pages/public/DeleteAccount.tsx': online(ACCOUNT),
  'pages/OrganizationProfile.tsx': online("Profil de l'entreprise et dépenses de l'entreprise : en ligne pour l'instant (les dépenses pourraient passer hors ligne comme le carnet)."),
  'pages/organization/OnboardingWizard.tsx': online(ACCOUNT),
  'components/OrganizationReviewPanel.tsx': online(ADMIN),
  'components/MerchantInvitations.tsx': online(ACCOUNT),
  'pages/merchant/Team.tsx': online(SETUP),

  // ---- En ligne : paramétrage de l'entreprise
  'components/stock/StockItemFormSheet.tsx': online('Créer ou modifier un produit : se fait en ligne ; la caisse garde le catalogue connu.'),
  'components/stock/StockPasswordDialog.tsx': online(SECURITY),
  'components/stock/StockPasswordResetDialog.tsx': online(SECURITY),
  'components/stock/StockSecurityCard.tsx': online(SECURITY),
  'pages/organization/Stock.tsx': online(SETUP),
  'pages/organization/Staff.tsx': online(SETUP),
  'pages/organization/Stores.tsx': online(SETUP),
  'pages/pos/PosPage.tsx': online("Ouvrir la caisse (fond de caisse) et reprendre un ticket en attente : demandent le serveur ; une caisse déjà ouverte vend sans réseau."),

  // ---- En ligne : préférences et notifications
  'components/NotificationDetailDialog.tsx': online(PREFS),
  'components/NotificationsBell.tsx': online(PREFS),
  'components/SoundSettings.tsx': online(PREFS),
  'pages/Notifications.tsx': online(PREFS),
  'pages/Settings.tsx': online(PREFS),

  // ---- En ligne : administration
  'components/admin/AdminTwoFactorPauseCard.tsx': online(ADMIN),
  'components/admin/IndicativeRateCard.tsx': online(ADMIN),
  'components/admin/SupportContactsCard.tsx': online(ADMIN),
  'pages/admin/AppSecurity.tsx': online(ADMIN),
  'pages/admin/Banks.tsx': online(ADMIN),
  'pages/admin/CardPrint.tsx': online(ADMIN),
  'pages/admin/Cards.tsx': online(ADMIN),
  'pages/admin/Commissions.tsx': online(ADMIN),
  'pages/admin/Exchange.tsx': online(ADMIN),
  'pages/admin/ExpenseTrackerSettings.tsx': online(ADMIN),
  'pages/admin/Merchants.tsx': online(ADMIN),
  'pages/admin/RiskLogs.tsx': online(ADMIN),
  'pages/admin/Settlements.tsx': online(ADMIN),
  'pages/admin/Subscriptions.tsx': online(ADMIN),
  'pages/admin/SupplierPlanAdmin.tsx': online(ADMIN),
  'pages/admin/Treasury.tsx': online(ADMIN),
  'pages/admin/Users.tsx': online(ADMIN),
  'pages/admin/WalletLimits.tsx': online(ADMIN),
  'pages/admin/Withdrawals.tsx': online(ADMIN),

  // ---- Mécanismes internes (pas des écrans)
  'lib/api.ts': online(SYSTEM),
  'lib/auth-store.ts': online('Connexion, déconnexion, profil : la session se refait au retour du réseau.'),
  'lib/device-integrity.ts': online(SYSTEM),
  'lib/native-push.ts': online(SYSTEM),
  'lib/push.ts': online(SYSTEM),
  'lib/webauthn.ts': online(SECURITY),
  'lib/outbox-handlers.ts': { mode: 'system', why: "C'est ici que les opérations faites hors ligne partent au retour du réseau." },
};
