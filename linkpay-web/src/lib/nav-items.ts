import { isSupermarket } from '@/lib/sectors';
import { ArrowLeftRight, LayoutDashboard, QrCode, Receipt, Wallet, Users, UserCog, ShieldCheck, Settings, Percent, Building2, UsersRound, RefreshCcw, PiggyBank, Bell, Boxes, ShoppingCart, BarChart3, History, ClipboardList, ScrollText, Store, SlidersHorizontal, ShieldAlert, Sparkles, CreditCard, ScanLine, ArrowUpFromLine, FileBarChart, Truck, CloudUpload, Landmark, PackageSearch, Handshake, Vault, type LucideIcon } from 'lucide-react';

import { FEATURES } from '@/lib/features';
import { ALL_ROLES, STAFF_ROLES, PERSONAL_ROLES, rolesFor } from '@/lib/permissions';

export { ALL_ROLES, STAFF_ROLES };

/** The sidebar (computer) and the « Plus » page (phone) group the entries by what they are for, in this order. */
export type NavSection = 'home' | 'sell' | 'follow' | 'stock' | 'business' | 'account' | 'admin' | 'system';
export const NAV_SECTIONS: { id: NavSection; title: string }[] = [
  { id: 'home', title: '' },
  { id: 'sell', title: 'Vendre' },
  { id: 'follow', title: 'Suivi' },
  { id: 'stock', title: 'Stock' },
  { id: 'business', title: 'Entreprise' },
  { id: 'account', title: 'Mon compte' },
  { id: 'admin', title: 'Administration' },
  { id: 'system', title: '' },
];

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  section: NavSection;
  /** A grouped entry (administrators' menu): the pages it opens, shown as tabs at the top of each of them. */
  children?: NavItem[];
  /** The same screen named for a given role (e.g. the manager's « Mes employés »). */
  labelFor?: Record<string, string>;
}

// What each job sees (kept deliberately short, so nobody is lost in options
// that aren't theirs — the rules themselves live in lib/permissions.ts):
//   gerant     — their station: Caisse, Transactions, Stock, Statistiques, Employés, Abonnement
//   vendeur    — Ventes, Historique, Tableau de bord ventes (light)
//   caissier   — Caisse (till), Transactions du jour, Recevoir
//   magasinier — Stock & Approvisionnement, Inventaire
//   comptable  — Historique, Transactions, Statistiques, Journal, Tableau de bord
//   patron     — everything, every station
// Single source of truth for "where can this role go" — consumed by both
// the desktop sidebar (DashboardLayout.tsx) and its mobile equivalent
// (pages/More.tsx, the "Plus" tab), so the two never drift out of sync.
// Within a section, the most used entry comes first: selling before anything else, right after the dashboard.
//
// Merchant-scoped pages (payment-requests, transactions) need
// the JWT's merchant_id claim — an enterprise account only gets one while
// "acting as" a specific store (role becomes 'merchant' then; see
// auth-store.ts enterStore()), never at the plain org level, so 'enterprise'
// deliberately isn't listed on these — org-level enterprise instead gets
// its own entries further down.
export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, roles: [...ALL_ROLES, ...STAFF_ROLES], section: 'home' },

  // ---- Vendre: the day-to-day action of the account.
  // Supermarket till (hidden for electronics); plain 'merchant' isn't in the POS controller's @Roles list.
  { to: '/dashboard/pos', label: 'Caisse', icon: Store, roles: rolesFor('/dashboard/pos'), section: 'sell' },
  // Electronics shops' sales (hidden for supermarkets).
  { to: '/dashboard/organization/sales', label: 'Ventes', icon: ShoppingCart, roles: rolesFor('/dashboard/organization/sales'), section: 'sell' },
  // The merchant's fixed payment QR + ScanLinkPay number — on mobile it is the bottom bar's central tab.
  { to: '/dashboard/wallet/receive', label: 'Encaisser', icon: QrCode, roles: ['merchant', 'cashier'], section: 'sell' },
  { to: '/dashboard/payment-requests', label: 'Demandes de paiement', icon: QrCode, roles: ['merchant', 'cashier'], section: 'sell' },
  { to: '/dashboard/card/charge', label: 'Encaisser par carte', icon: ScanLine, roles: rolesFor('/dashboard/card/charge'), section: 'sell' },
  { to: '/dashboard/organization/receive', label: 'Recevoir', icon: QrCode, roles: rolesFor('/dashboard/organization/receive').filter((r) => r !== 'enterprise'), section: 'sell' },

  // ---- Suivi: what was sold and paid.
  { to: '/dashboard/organization/sales/history', label: 'Historique des ventes', icon: History, roles: rolesFor('/dashboard/organization/sales/history'), section: 'follow' },
  { to: '/dashboard/organization/my-sales', label: 'Mes ventes', icon: History, roles: rolesFor('/dashboard/organization/my-sales'), section: 'follow' },
  // Staff-only (the enterprise owner reaches it from its own home), so it isn't duplicated for enterprise.
  { to: '/dashboard/organization/sales/dashboard', label: 'Tableau de bord ventes', icon: BarChart3, roles: rolesFor('/dashboard/organization/sales/dashboard'), section: 'follow' },
  { to: '/dashboard/organization/transactions', label: 'Transactions', icon: Receipt, roles: rolesFor('/dashboard/organization/transactions'), section: 'follow' },
  // For a merchant, "Transactions" (bottom bar) is the wallet's history; this list is the customers' payments (with refunds).
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, roles: ['merchant', 'cashier'], labelFor: { merchant: 'Paiements reçus' }, section: 'follow' },
  { to: '/dashboard/organization/stats', label: 'Statistiques', icon: BarChart3, roles: rolesFor('/dashboard/organization/stats'), section: 'follow' },
  { to: '/dashboard/organization/reports', label: 'Rapports', icon: FileBarChart, roles: rolesFor('/dashboard/organization/reports'), section: 'follow' },
  { to: '/dashboard/organization/reports/sellers', label: 'Rapport des vendeurs', icon: Users, roles: rolesFor('/dashboard/organization/reports/sellers'), section: 'follow' },
  { to: '/dashboard/organization/audit', label: 'Journal', icon: ScrollText, roles: rolesFor('/dashboard/organization/audit'), section: 'follow' },

  // ---- Stock.
  { to: '/dashboard/organization/stock', label: 'Stock', icon: Boxes, roles: rolesFor('/dashboard/organization/stock'), section: 'stock' },
  { to: '/dashboard/organization/inventory', label: 'Inventaire', icon: ClipboardList, roles: rolesFor('/dashboard/organization/inventory'), section: 'stock' },
  { to: '/dashboard/organization/restock', label: "Demandes d'achat", icon: Truck, roles: rolesFor('/dashboard/organization/restock'), section: 'stock' },
  { to: '/dashboard/organization/supplier-orders', label: 'Mes fournisseurs', icon: PackageSearch, roles: rolesFor('/dashboard/organization/supplier-orders'), section: 'stock' },
  { to: '/dashboard/organization/supplier', label: 'Espace fournisseur', icon: Handshake, roles: rolesFor('/dashboard/organization/supplier'), section: 'business' },

  { to: '/dashboard/organization/cash', label: 'Caisse & clôture', icon: Vault, roles: rolesFor('/dashboard/organization/cash'), section: 'follow' },

  // ---- Entreprise: business modules, not account config, so they live in the nav rather than Settings.
  { to: '/dashboard/organization/treasury', label: 'Trésorerie', icon: Landmark, roles: rolesFor('/dashboard/organization/treasury'), section: 'business' },
  { to: '/dashboard/organization/wallet', label: 'Portefeuille entreprise', icon: Wallet, roles: rolesFor('/dashboard/organization/wallet'), section: 'business' },
  { to: '/dashboard/organization/staff', label: 'Utilisateurs internes', icon: Users, roles: rolesFor('/dashboard/organization/staff'), labelFor: { gerant: 'Mes employés' }, section: 'business' },
  { to: '/dashboard/team', label: 'Équipe', icon: UsersRound, roles: ['merchant'], section: 'business' },
  { to: '/dashboard/organization/stores', label: 'Stations', icon: Store, roles: rolesFor('/dashboard/organization/stores'), section: 'business' },
  { to: '/dashboard/organization/profile', label: 'Profil entreprise', icon: Building2, roles: rolesFor('/dashboard/organization/profile'), section: 'business' },
  { to: '/dashboard/organization/subscription', label: 'Abonnement', icon: Sparkles, roles: rolesFor('/dashboard/organization/subscription'), section: 'business' },

  // ---- Mon compte: the person's own money. Deliberately not for 'enterprise' (wallet, tontine, savings are
  // personal-account concepts; an organization has its own modules).
  // The wallet's history (the "Transactions" tab of the phone's bottom bar); on a computer, this sidebar entry.
  { to: '/dashboard/wallet/transactions', label: 'Transactions', icon: ArrowLeftRight, roles: ['client', 'merchant'], section: 'account' },
  { to: '/dashboard/client/transactions', label: 'Mes paiements', icon: Receipt, roles: PERSONAL_ROLES, section: 'account' },
  // Employees' own wallet: where the patron sends their salary and from where they withdraw it — never the station's.
  { to: '/dashboard/wallet', label: 'Mon portefeuille', icon: Wallet, roles: rolesFor('/dashboard/wallet'), section: 'account' },
  // The personal ScanLinkPay card — not on a work (staff) account.
  { to: '/dashboard/card', label: 'Ma carte', icon: CreditCard, roles: rolesFor('/dashboard/card'), section: 'account' },
  { to: '/dashboard/expenses', label: 'Mes dépenses', icon: Receipt, roles: ['client', 'merchant', 'cashier', 'admin', 'super_admin'], section: 'account' },
  ...(FEATURES.tontines ? [{ to: '/dashboard/tontines', label: 'Tontines', icon: RefreshCcw, roles: PERSONAL_ROLES, section: 'account' as const }] : []),
  ...(FEATURES.savings ? [{ to: '/dashboard/savings', label: 'Épargne', icon: PiggyBank, roles: PERSONAL_ROLES, section: 'account' as const }] : []),

  // ---- Administration (ScanLinkPay team).
  { to: '/dashboard/admin', label: 'Administration', icon: ShieldCheck, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/withdrawals', label: 'Retraits à traiter', icon: ArrowUpFromLine, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/security-alerts', label: 'Alertes de sécurité', icon: ShieldAlert, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/organizations', label: 'Entreprises', icon: Building2, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/merchants', label: 'Commerçants', icon: Users, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/cards', label: 'Cartes', icon: CreditCard, roles: ['admin', 'super_admin'], section: 'admin' },
  { to: '/dashboard/admin/settlements', label: 'Règlements', icon: Wallet, roles: ['admin', 'super_admin'], section: 'admin' },
  // What ScanLinkPay may take out of its FlexPaie account without touching the users' money (migration 079).
  { to: '/dashboard/admin/treasury', label: 'Trésorerie', icon: Landmark, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/users', label: 'Utilisateurs', icon: UserCog, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/subscriptions', label: 'Abonnements', icon: Sparkles, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/commissions', label: 'Commissions', icon: Percent, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/wallet-limits', label: 'Frais et limites', icon: SlidersHorizontal, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/expense-tracker-settings', label: 'Config. des dépenses', icon: Receipt, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/banks', label: 'Banques de retrait', icon: Landmark, roles: ['super_admin'], section: 'admin' },
  { to: '/dashboard/admin/app-security', label: "Sécurité de l'application", icon: ShieldCheck, roles: ['super_admin'], section: 'admin' },

  // ---- Always last. Synchronisation (what waits to be sent after working offline) is in Paramètres; the sidebar
  // shows it only while something waits (DashboardLayout / More).
  { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, roles: [...ALL_ROLES, ...STAFF_ROLES], section: 'system' },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, roles: [...ALL_ROLES, ...STAFF_ROLES], section: 'system' },
];

/** Shown in the nav only while operations made offline wait to reach the server (lib/outbox.ts). */
export const SYNC_NAV_ITEM: NavItem = { to: '/dashboard/sync', label: 'Synchronisation', icon: CloudUpload, roles: [...ALL_ROLES, ...STAFF_ROLES], section: 'system' };

/** The entries grouped by section, in NAV_SECTIONS order; empty sections left out. */
export function groupNavItems(items: NavItem[]) {
  // The ScanLinkPay team works in Administration: it comes right after the dashboard, before their own account.
  const order = items.some((i) => i.section === 'admin')
    ? [NAV_SECTIONS[0], NAV_SECTIONS.find((s) => s.id === 'admin')!, ...NAV_SECTIONS.slice(1).filter((s) => s.id !== 'admin')]
    : NAV_SECTIONS;
  return order
    .map((section) => ({ ...section, items: items.filter((i) => i.section === section.id) }))
    .filter((section) => section.items.length > 0);
}

// Sector-conditional entries — a supermarket sells at the POS till, so
// the Ventes sales form + its history/dashboard (the electronics flow)
// are redundant for that sector and hidden from the nav entirely.
// An electronics shop sells in Ventes: the supermarket till and the cashier's till tickets (« Mes ventes ») are
// empty there, so hidden too.
const SECTOR_HIDDEN: Record<string, string[]> = {
  supermarche: [
    '/dashboard/organization/sales',
    '/dashboard/organization/sales/history',
  ],
  electronique: [
    '/dashboard/pos',
    '/dashboard/organization/my-sales',
  ],
};

export function navItemsFor(role: string, sector?: string): NavItem[] {
  const hidden = new Set(sector ? SECTOR_HIDDEN[isSupermarket(sector) ? 'supermarche' : sector] ?? [] : []);
  return navItems
    .filter((i) => i.roles.includes(role) && !hidden.has(i.to))
    .map((i) => (i.labelFor?.[role] ? { ...i, label: i.labelFor[role] } : i));
}

// ---------------------------------------------------------------------------------------------------------------------
// The administrators' menu is grouped: about twenty entries become eight. Each group opens its first page; its pages
// are tabs at the top of each of them (HubTabs in DashboardLayout). Every page keeps its own address, so old links
// and notifications still open the right one. Other accounts keep their menu as it is.
// ---------------------------------------------------------------------------------------------------------------------
const ADMIN_HUBS: { label: string; icon: LucideIcon; section: NavSection; pages: { to: string; tab: string }[] }[] = [
  { label: 'Tableau de bord', icon: LayoutDashboard, section: 'home', pages: [{ to: '/dashboard/admin', tab: 'Tableau de bord' }] },
  {
    label: 'Argent', icon: Landmark, section: 'admin',
    pages: [
      { to: '/dashboard/admin/treasury', tab: 'Trésorerie' },
      { to: '/dashboard/admin/withdrawals', tab: 'Retraits à traiter' },
      { to: '/dashboard/admin/settlements', tab: 'Règlements' },
      { to: '/dashboard/admin/banks', tab: 'Banques de retrait' },
    ],
  },
  {
    label: 'Comptes', icon: Users, section: 'admin',
    pages: [
      { to: '/dashboard/admin/users', tab: 'Utilisateurs' },
      { to: '/dashboard/admin/merchants', tab: 'Commerçants' },
      { to: '/dashboard/admin/organizations', tab: 'Entreprises' },
      { to: '/dashboard/admin/cards', tab: 'Cartes' },
    ],
  },
  {
    label: 'Tarifs', icon: Percent, section: 'admin',
    pages: [
      { to: '/dashboard/admin/commissions', tab: 'Commissions' },
      { to: '/dashboard/admin/wallet-limits', tab: 'Frais et limites' },
      { to: '/dashboard/admin/subscriptions', tab: 'Abonnements' },
      { to: '/dashboard/admin/expense-tracker-settings', tab: 'Mes dépenses (Pro)' },
    ],
  },
  {
    label: 'Sécurité', icon: ShieldAlert, section: 'admin',
    pages: [
      { to: '/dashboard/admin/security-alerts', tab: 'Alertes' },
      { to: '/dashboard/admin/app-security', tab: "Sécurité de l'application" },
    ],
  },
  {
    label: 'Mon compte', icon: Wallet, section: 'account',
    pages: [
      { to: '/dashboard/client/transactions', tab: 'Mes paiements' },
      { to: '/dashboard/card', tab: 'Ma carte' },
      { to: '/dashboard/expenses', tab: 'Mes dépenses' },
    ],
  },
];

/**
 * The menu as shown: for administrators, their pages grouped (ADMIN_HUBS) — a group keeps only the pages this role may
 * open, opens the first one, and is a plain entry when only one is left. Everyone else: `items` unchanged.
 */
export function menuFor(role: string, items: NavItem[]): NavItem[] {
  if (role !== 'admin' && role !== 'super_admin') return items;
  const grouped = new Set(ADMIN_HUBS.flatMap((h) => h.pages.map((p) => p.to)));
  const hubs: NavItem[] = [];
  for (const hub of ADMIN_HUBS) {
    const pages = hub.pages
      .map((p) => {
        const item = items.find((i) => i.to === p.to);
        return item ? { ...item, label: p.tab } : null;
      })
      .filter((i): i is NavItem => !!i);
    if (!pages.length) continue;
    hubs.push({ to: pages[0].to, label: hub.label, icon: hub.icon, roles: [role], section: hub.section, children: pages.length > 1 ? pages : undefined });
  }
  // « Tableau de bord » (/dashboard) only redirects administrators to /dashboard/admin: the group replaces it.
  const rest = items.filter((i) => !grouped.has(i.to) && i.to !== '/dashboard');
  return [...hubs, ...rest];
}

/** The group the page at `pathname` belongs to (the longest matching page wins: /dashboard/admin vs its sub-pages). */
export function hubOf(pathname: string, menu: NavItem[]): NavItem | undefined {
  let best: { hub: NavItem; len: number } | undefined;
  for (const hub of menu) {
    for (const page of hub.children ?? [hub]) {
      // The dashboard is lit on itself only (every page lives under /dashboard).
      const under = page.to !== '/dashboard' && pathname.startsWith(`${page.to}/`);
      if ((pathname === page.to || under) && page.to.length > (best?.len ?? -1)) best = { hub, len: page.to.length };
    }
  }
  return best?.hub;
}
