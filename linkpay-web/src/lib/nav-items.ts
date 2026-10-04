import { LayoutDashboard, QrCode, Receipt, Wallet, Users, UserCog, ShieldCheck, Settings, Percent, Building2, UsersRound, RefreshCcw, PiggyBank, Bell, Boxes, type LucideIcon } from 'lucide-react';

export const ALL_ROLES = ['merchant', 'cashier', 'enterprise', 'client', 'admin', 'super_admin'];

// Enterprise-internal staff (created via OrganizationStaffController, see
// organization-staff module) — no wallet, no caisse/ventes module exists
// yet for them to use, so they deliberately get only a minimal nav
// (dashboard + settings), not the full ALL_ROLES set (which includes
// wallet-dependent items like Tontines/Épargne/Mes paiements they can't
// actually use yet).
export const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

// Single source of truth for "where can this role go" — consumed by both
// the desktop sidebar (DashboardLayout.tsx) and its mobile equivalent
// (MobileNavDrawer.tsx), so the two never drift out of sync. Settings.tsx
// keeps its own, separate secondaryLinks list for genuine account
// configuration (e.g. "Profil entreprise") — only full modules belong
// here.
//
// Merchant-scoped pages (payment-requests, transactions, settlements) need
// the JWT's merchant_id claim — an enterprise account only gets one while
// "acting as" a specific store (role becomes 'merchant' then; see
// auth-store.ts enterStore()), never at the plain org level, so 'enterprise'
// deliberately isn't listed on these — org-level enterprise instead gets
// its own entries further down.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, roles: [...ALL_ROLES, ...STAFF_ROLES] },
  { to: '/dashboard/payment-requests', label: 'Demandes de paiement', icon: QrCode, roles: ['merchant', 'cashier'] },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, roles: ['merchant', 'cashier'] },
  { to: '/dashboard/settlements', label: 'Règlements', icon: Wallet, roles: ['merchant'] },
  { to: '/dashboard/team', label: 'Équipe', icon: UsersRound, roles: ['merchant'] },
  // Deliberately excludes 'enterprise' — wallet/tontine/savings features are
  // personal-account concepts; an organization has its own separate stock,
  // expenses, etc. modules instead (see OrganizationProfile.tsx).
  { to: '/dashboard/client/transactions', label: 'Mes paiements', icon: Receipt, roles: ALL_ROLES.filter((r) => r !== 'enterprise') },
  { to: '/dashboard/tontines', label: 'Tontines', icon: RefreshCcw, roles: ALL_ROLES.filter((r) => r !== 'enterprise') },
  { to: '/dashboard/savings', label: 'Épargne', icon: PiggyBank, roles: ALL_ROLES.filter((r) => r !== 'enterprise') },
  // Deliberately excludes 'enterprise' — organizations have their own,
  // separate expense feature (see OrganizationProfile.tsx's expense tile),
  // unlike tontines/savings above which enterprise can currently also see.
  { to: '/dashboard/expenses', label: 'Mes dépenses', icon: Receipt, roles: ['client', 'merchant', 'cashier', 'admin', 'super_admin'] },
  { to: '/dashboard/admin', label: 'Administration', icon: ShieldCheck, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/merchants', label: 'Commerçants', icon: Users, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/organizations', label: 'Entreprises', icon: Building2, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/settlements', label: 'Règlements (admin)', icon: Wallet, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/users', label: 'Utilisateurs', icon: UserCog, roles: ['super_admin'] },
  { to: '/dashboard/admin/commissions', label: 'Commissions', icon: Percent, roles: ['super_admin'] },
  { to: '/dashboard/admin/expense-tracker-settings', label: 'Dépenses — Config.', icon: Receipt, roles: ['super_admin'] },
  // The one enterprise module kept at this top level — Transactions and
  // Utilisateurs internes moved to Settings.tsx's secondaryLinks instead
  // per product decision (only Stock & Approvisionnement stays a
  // first-level module in the sidebar/drawer).
  { to: '/dashboard/organization/stock', label: 'Stock & Approvisionnement', icon: Boxes, roles: ['enterprise'] },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, roles: [...ALL_ROLES, ...STAFF_ROLES] },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, roles: [...ALL_ROLES, ...STAFF_ROLES] },
];
