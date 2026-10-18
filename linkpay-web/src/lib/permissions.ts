/**
 * Who may open which screen — the single source for both the menus
 * (nav-items.ts → sidebar, bottom bar, "Plus") and the route guards in
 * App.tsx, so a screen hidden from a role is also closed to it by URL.
 * The API enforces the same rules on its side; this only keeps the app
 * from showing what the server would refuse.
 */

/** Account types outside an organization's staff. */
export const ALL_ROLES = ['merchant', 'cashier', 'enterprise', 'client', 'admin', 'super_admin'];

/**
 * Enterprise staff (organization-staff module). Each works in ONE station
 * (a store of the organization) and only sees that station.
 *   gerant     — runs a station: dashboard, till, staff, stats, subscription
 *   caissier   — the till, today's payments
 *   vendeur    — sales
 *   magasinier — stock and inventories
 *   comptable  — the numbers: history, transactions, stats, journal
 * The owner ('enterprise') sees every station.
 */
export const STAFF_ROLES = ['gerant', 'magasinier', 'vendeur', 'caissier', 'comptable'];

/** How a role reads on screen. */
export const ROLE_LABELS: Record<string, string> = {
  enterprise: 'Responsable',
  gerant: 'Gérant de station',
  caissier: 'Caissier',
  vendeur: 'Vendeur',
  magasinier: 'Magasinier',
  comptable: 'Comptable',
};

export const isStaffRole = (role: string | undefined | null) => !!role && STAFF_ROLES.includes(role);

/** Personal-account screens (tontines, savings, personal card...) — not for a work account. */
export const PERSONAL_ROLES = ALL_ROLES.filter((r) => r !== 'enterprise');

export const ROUTE_ROLES = {
  '/dashboard/organization': ['enterprise'],
  '/dashboard/organization/profile': ['enterprise'],
  '/dashboard/organization/stores': ['enterprise'],
  '/dashboard/organization/staff': ['enterprise', 'gerant'],
  '/dashboard/organization/subscription': ['enterprise', 'gerant'],
  // The owner's wallet, where every station's ScanLinkPay payments land (and the subscription is paid from).
  '/dashboard/organization/wallet': ['enterprise'],
  '/dashboard/organization/sales': ['enterprise', 'gerant', 'vendeur', 'caissier'],
  '/dashboard/organization/sales/history': ['enterprise', 'gerant', 'vendeur', 'caissier', 'comptable'],
  '/dashboard/organization/sales/dashboard': ['enterprise', 'gerant', 'vendeur', 'comptable'],
  '/dashboard/organization/stock': ['enterprise', 'gerant', 'magasinier'],
  '/dashboard/organization/inventory': ['enterprise', 'magasinier'],
  // Restock requests: the station asks, the owner decides.
  '/dashboard/organization/restock': ['enterprise', 'gerant', 'magasinier'],
  // The manager has « Rapports » (same figures and more): no duplicate screen for them.
  '/dashboard/organization/stats': ['enterprise', 'comptable'],
  '/dashboard/organization/reports': ['enterprise', 'gerant', 'comptable'],
  // A cashier's (or seller's) own sales of the month.
  '/dashboard/organization/my-sales': ['caissier', 'vendeur'],
  '/dashboard/organization/transactions': ['enterprise', 'gerant', 'caissier', 'comptable'],
  '/dashboard/organization/audit': ['enterprise', 'comptable'],
  '/dashboard/organization/receive': ['enterprise', 'gerant', 'caissier'],
  '/dashboard/pos': ['enterprise', 'gerant', 'caissier'],
  // The personal ScanLinkPay card: the owner keeps theirs, a work (staff) account has none.
  '/dashboard/card': ALL_ROLES,
  '/dashboard/card/charge': ['merchant', 'cashier', 'enterprise', 'gerant', 'caissier', 'vendeur'],
  // Employees' own wallet: where the owner sends their salary and from where they withdraw it.
  '/dashboard/wallet': STAFF_ROLES,
  '/dashboard/client/transactions': PERSONAL_ROLES,
  '/dashboard/tontines': PERSONAL_ROLES,
  '/dashboard/savings': PERSONAL_ROLES,
} satisfies Record<string, string[]>;

export type GuardedRoute = keyof typeof ROUTE_ROLES;

export function rolesFor(route: GuardedRoute): string[] {
  return ROUTE_ROLES[route];
}
