import { LayoutDashboard, QrCode, Receipt, Wallet, Users, UserCog, ShieldCheck, Settings, Percent, Building2, UsersRound, RefreshCcw, PiggyBank, Bell, Boxes, ShoppingCart, BarChart3, History, ClipboardList, ScrollText, Store, type LucideIcon } from 'lucide-react';

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
// (pages/More.tsx, the "Plus" tab), so the two never drift out of sync. Settings.tsx
// keeps its own, separate secondaryLinks list for genuine account
// configuration (e.g. "Profil entreprise") — only full modules belong
// here.
//
// Merchant-scoped pages (payment-requests, transactions) need
// the JWT's merchant_id claim — an enterprise account only gets one while
// "acting as" a specific store (role becomes 'merchant' then; see
// auth-store.ts enterStore()), never at the plain org level, so 'enterprise'
// deliberately isn't listed on these — org-level enterprise instead gets
// its own entries further down.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, roles: [...ALL_ROLES, ...STAFF_ROLES] },
  { to: '/dashboard/payment-requests', label: 'Demandes de paiement', icon: QrCode, roles: ['merchant', 'cashier'] },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, roles: ['merchant', 'cashier'] },
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
  { to: '/dashboard/admin/app-security', label: "Sécurité de l'application", icon: ShieldCheck, roles: ['super_admin'] },
  // The one enterprise module kept at this top level — Transactions and
  // Utilisateurs internes moved to Settings.tsx's secondaryLinks instead
  // per product decision (only Stock & Approvisionnement stays a
  // first-level module in the sidebar/drawer).
  { to: '/dashboard/organization/sales', label: 'Ventes', icon: ShoppingCart, roles: ['enterprise', 'vendeur', 'caissier'] },
  { to: '/dashboard/organization/sales/history', label: 'Historique', icon: History, roles: ['enterprise', 'vendeur', 'caissier', 'comptable'] },
  { to: '/dashboard/organization/stock', label: 'Stock & Approvisionnement', icon: Boxes, roles: ['enterprise', 'magasinier', 'vendeur'] },
  // Supermarket module — the till is the staff's day-to-day screen.
  // Plain 'merchant' isn't in the POS controller's @Roles list (backend
  // resolves the store via merchant.owner_id for org owners), so it's not
  // listed here either.
  { to: '/dashboard/pos', label: 'Caisse', icon: Store, roles: ['enterprise', 'caissier', 'magasinier'] },
  { to: '/dashboard/organization/inventory', label: 'Inventaire', icon: ClipboardList, roles: ['enterprise', 'magasinier'] },
  { to: '/dashboard/organization/stats', label: 'Statistiques', icon: BarChart3, roles: ['enterprise', 'comptable'] },
  { to: '/dashboard/organization/audit', label: 'Journal', icon: ScrollText, roles: ['enterprise', 'comptable'] },
  // Staff-only finance entries (the enterprise owner reaches the same screens
  // from its own Settings → Gestion, so they aren't duplicated for enterprise).
  { to: '/dashboard/organization/sales/dashboard', label: 'Tableau de bord ventes', icon: BarChart3, roles: ['vendeur', 'caissier', 'comptable'] },
  { to: '/dashboard/organization/transactions', label: 'Transactions', icon: Receipt, roles: ['enterprise', 'caissier', 'comptable'] },
  { to: '/dashboard/organization/receive', label: 'Recevoir', icon: QrCode, roles: ['caissier'] },
  // Org management — business modules, not account config, so they live
  // in the nav (sidebar/desktop, Plus/mobile) rather than Settings.
  { to: '/dashboard/organization/profile', label: 'Profil entreprise', icon: Building2, roles: ['enterprise'] },
  { to: '/dashboard/organization/stores', label: 'Boutiques', icon: Store, roles: ['enterprise'] },
  { to: '/dashboard/organization/staff', label: 'Utilisateurs internes', icon: Users, roles: ['enterprise'] },
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, roles: [...ALL_ROLES, ...STAFF_ROLES] },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, roles: [...ALL_ROLES, ...STAFF_ROLES] },
];

// Sector-conditional entries — a supermarket sells at the POS till, so
// the Ventes sales form + its history/dashboard (the electronics flow)
// are redundant for that sector and hidden from the nav entirely.
const SECTOR_HIDDEN: Record<string, string[]> = {
  supermarche: [
    '/dashboard/organization/sales',
    '/dashboard/organization/sales/history',
    '/dashboard/organization/sales/dashboard',
  ],
};

export function navItemsFor(role: string, sector?: string): NavItem[] {
  const hidden = new Set(sector ? SECTOR_HIDDEN[sector] ?? [] : []);
  return navItems.filter((i) => i.roles.includes(role) && !hidden.has(i.to));
}
