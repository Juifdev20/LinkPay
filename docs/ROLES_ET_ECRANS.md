# Rôles de l'entreprise et écrans visibles

Le patron crée ses employés dans **Paramètres → Utilisateurs internes → Ajouter** (nom, postnom, prénom, téléphone, email, **rôle**). L'application crée le compte avec un mot de passe temporaire que le patron remet à l'employé (fiche imprimable). À sa première connexion l'employé change ce mot de passe, puis choisit son **code d'accès** personnel.

| Rôle | Écrans visibles | Ce qu'il ne voit pas |
|---|---|---|
| **Patron** | Tout : Ventes, Caisse, Stock & Approvisionnement, Inventaire, Statistiques, Journal, Transactions, Boutiques, Utilisateurs internes, Profil entreprise | — |
| **Vendeur** | Ventes, Historique, Tableau de bord ventes (version simple, sans marges) | Stock & Approvisionnement, Caisse, Inventaire, prix d'achat |
| **Caissier** | Caisse (point de vente), Ventes, Historique, Transactions, Recevoir | Stock & Approvisionnement, Inventaire, Tableau de bord ventes, prix d'achat |
| **Magasinier** (chargé de stock) | Stock & Approvisionnement, Inventaire, Alertes | Caisse, Ventes, Transactions, Statistiques |
| **Comptable** | Historique, Transactions, Statistiques, Journal, Tableau de bord ventes (complet) | Stock, Caisse, Inventaire |

Les écrans sont filtrés dans les menus **et** protégés par l'adresse (un employé qui tape l'URL d'un écran qui n'est pas le sien est renvoyé), et par l'API pour les données sensibles (prix d'achat, historique des mouvements de stock).

La liste vit dans `linkpay-web/src/lib/nav-items.ts` (menus), `linkpay-web/src/App.tsx` (accès par adresse) et `linkpay-web/src/components/BottomNav.tsx` (barre mobile).

## Changer le rôle d'un employé, ou retirer son accès

Dans **Paramètres → Utilisateurs internes**, chaque employé actif a un sélecteur **Rôle** et un bouton **Retirer l'accès**. Le patron confirme avec son propre code d'accès.

- **Changer le rôle** (ex. vendeur → caissier) : l'employé est déconnecté et, à sa prochaine connexion, voit les écrans de son nouveau rôle. Il reçoit une notification. Seuls les rôles d'employé sont proposés (jamais un rôle d'administrateur).
- **Retirer l'accès** (l'employé part) : son compte est bloqué dans Supabase Auth (connexion impossible, message « Votre accès a été retiré »), ses sessions sont coupées immédiatement (un jeton resté sur son téléphone est refusé à la requête suivante) et le mot de passe temporaire non utilisé est effacé. Ses ventes, mouvements de stock et entrées du journal sont conservés.
- **Rétablir l'accès** (l'employé revient) : le compte est débloqué avec un nouveau mot de passe temporaire à changer à la première connexion.
- Les trois actions sont inscrites dans le **Journal** (qui, quand, quel employé).

## Le salaire des employés

Chaque employé a son **propre portefeuille ScanLinkPay** (menu « Mon portefeuille », ou « Portefeuille » dans la barre du bas pour le magasinier ; « Plus » pour les autres rôles sur mobile).

1. L'employé y trouve son **numéro ScanLinkPay** et le donne au patron.
2. Le patron lui envoie le salaire par **Envoyer** (transfert ScanLinkPay).
3. L'employé appuie sur **Retirer mon salaire**, choisit Mobile Money, saisit son PIN de transaction : l'argent part vers son téléphone.

Il ne retire que **son** argent : les recettes du commerce restent dans le portefeuille du patron, hors de portée des employés.

## Licences (par entreprise)

Le patron achète, depuis son portefeuille, des jours de licence pour les fonctionnalités qu'il coche (ou « Toute l'application »), page **Licence**. Les employés n'achètent rien : s'ils ouvrent un écran sans licence, ils lisent « Vous n'avez pas de licence pour cette fonctionnalité » et sont invités à prévenir le patron.

| Fonctionnalité | Écrans / actions concernés |
| --- | --- |
| Caisse | Caisse (encaissement, sessions, mouvements d'espèces) |
| Ventes | Ventes, historique, tableau de bord des ventes |
| Stock | Ajouter / modifier / supprimer un article, mouvements, photo |
| Inventaire | Inventaires |
| Statistiques | Statistiques de la caisse |
| Journal | Journal d'audit |
| Employés | Ajouter un employé (retirer un accès ou changer un rôle reste toujours possible) |

Toujours disponibles quelle que soit la licence : paiements des clients, portefeuille, retraits, notifications, paramètres.
