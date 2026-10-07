import { NavLink, useLocation } from 'react-router-dom';
import { Home, Receipt, QrCode, Settings, ShoppingCart, Boxes, BarChart3, Bell, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useSheetStore } from '@/lib/sheet-store';
import { useAuthStore } from '@/lib/auth-store';
import { navItemsFor } from '@/lib/nav-items';

// "Profil" moved to TopBar.tsx (top-right icon) — this slot is now the app
// Settings destination, matching what the desktop sidebar already calls it
// (DashboardLayout.tsx's navItems: '/dashboard/settings' → "Paramètres").
// The central "QR" tab's target depends on role — see BottomNav() below.
type Tab = { to: string; label: string; icon: typeof Home; end: boolean; central?: boolean };

const SALES_DASHBOARD_PATH = '/dashboard/organization/sales/dashboard';

const tabs: Tab[] = [
  { to: '/dashboard', label: 'Accueil', icon: Home, end: true },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, end: false },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, end: false },
];

// Internal staff get the tabs that match their own sidebar (see
// lib/nav-items.ts) instead of the owner/client set above — no wallet tabs.
// The sales dashboard is the staff home, so Accueil stays lit on it; the
// central tabs are lit only on their exact page (end: true).
const homeTab = tabs[0];
const settingsTab = tabs[2];
const salesTab: Tab = { to: '/dashboard/organization/sales', label: 'Ventes', icon: ShoppingCart, end: true, central: true };
const stockTab: Tab = { to: '/dashboard/organization/stock', label: 'Stock', icon: Boxes, end: false };
const orgTransactionsTab: Tab = { to: '/dashboard/organization/transactions', label: 'Transactions', icon: Receipt, end: false };
const financeTab: Tab = { to: SALES_DASHBOARD_PATH, label: 'Finances', icon: BarChart3, end: true, central: true };
const alertsTab: Tab = { to: '/dashboard/notifications', label: 'Alertes', icon: Bell, end: true, central: true };

// Selling is the daily business activity — the supermarket/electronics
// cashier lands on the POS till; other sectors keep the Ventes form.
const venteTab: Tab = { to: '/dashboard/pos', label: 'Vente', icon: ShoppingCart, end: false, central: true };

const staffTabsFor = (role: string, orgSector?: string): Tab[] | undefined => {
  const caissierSale = orgSector === 'supermarche' ? venteTab : salesTab;
  const map: Record<string, Tab[]> = {
    vendeur: [homeTab, stockTab, salesTab, settingsTab],
    caissier: [homeTab, orgTransactionsTab, caissierSale, settingsTab],
    comptable: [homeTab, orgTransactionsTab, financeTab, settingsTab],
    magasinier: [homeTab, stockTab, alertsTab, settingsTab],
  };
  return map[role];
};

// Entries that are navigation chrome, not business modules — the Plus tab
// appears only when the role has more than 3 *business* destinations,
// otherwise Paramètres keeps its own slot in the bar.
const NAV_CHROME_PATHS = ['/dashboard', '/dashboard/notifications', '/dashboard/settings'];

const MORE_PATH = '/dashboard/more';
// Three bars — the mobile "More" convention (same icon as the reference
// screens this replaces), not the ⋯ ellipsis which reads as "options".
const plusTab: Tab = { to: MORE_PATH, label: 'Plus', icon: Menu, end: false };

/** Which tabs a given user sees in the bottom bar — shared with More.tsx so
 * the "Plus" page can list exactly what the bar does NOT already show
 * (no duplicated entries: tautologies are the enemy of a clean mobile UX). */
export function computeVisibleTabs(
  user: { role?: string | null; merchant_id?: string | null; acting_as_org_id?: string | null } | null,
  orgSector?: string,
) {
  const role = user?.role;
  // "Acting as" a store swaps role to 'merchant' (auth-store.enterStore) —
  // the enterprise check must cover that, so the Vente tab survives it.
  const isEnterprise = role === 'enterprise' || !!user?.acting_as_org_id;
  const hasMerchantId = !!user?.merchant_id;

  // Business accounts sell daily — the central tab is "Vente" → the POS
  // till for enterprise, "QR" → payment request for plain merchants,
  // "Recevoir" → own QR for clients who can only receive.
  const qrTab = isEnterprise
    ? venteTab
    : hasMerchantId
    ? { to: '/dashboard/payment-requests/new', label: 'QR', icon: QrCode, end: false, central: true }
    : { to: '/dashboard/wallet/receive', label: 'Recevoir', icon: QrCode, end: false, central: true };
  const transactionsTab = isEnterprise
    ? { ...tabs[1], to: '/dashboard/organization/transactions' }
    : tabs[1];
  const allTabs = staffTabsFor(role || '', orgSector) ?? [tabs[0], transactionsTab, qrTab, tabs[2]];

  const navRole = isEnterprise ? 'enterprise' : role;
  const businessItemCount = navRole
    ? navItemsFor(navRole, orgSector).filter((i) => !NAV_CHROME_PATHS.includes(i.to)).length
    : 0;
  const usePlusTab = businessItemCount > 3;
  const displayTabs = usePlusTab
    ? [...allTabs.filter((t) => t.to !== '/dashboard/settings'), plusTab]
    : allTabs;
  return { displayTabs, usePlusTab };
}

export function BottomNav() {
  // Hidden while a FormSheet is open — the sheet owns the keyboard-aware
  // bottom-of-screen real estate at that point (see FormSheet.tsx /
  // sheet-store.ts). The sheet's own z-index already visually covers this
  // bar, but sliding it fully out of the way too avoids leaving its links
  // focusable/tappable underneath.
  const hidden = useSheetStore((s) => s.isOpen);
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const { pathname } = useLocation();
  const onSalesDashboard = pathname === SALES_DASHBOARD_PATH;

  // Org sector drives the caissier's sale tab (POS vs Ventes) — same
  // queryKey/enabled as DashboardLayout, so the response is shared cache,
  // not an extra request. Until it resolves, caissier keeps salesTab.
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: role === 'enterprise' || !!user?.organization_id,
  });

  const { displayTabs, usePlusTab } = computeVisibleTabs(user, org?.sector);
  // "Plus" stays lit while a page reachable only through it is open —
  // otherwise the bar would show nothing selected on those screens.
  const navRole = user?.acting_as_org_id || role === 'enterprise' ? 'enterprise' : role;
  const plusActive =
    usePlusTab &&
    navItemsFor(navRole || '', org?.sector).some(
      (i) =>
        !displayTabs.some((t) => t.to === i.to) &&
        (i.to === '/dashboard' ? pathname === i.to : pathname.startsWith(i.to)),
    );

  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-nav safe-area-bottom transition-transform duration-200',
        hidden && 'translate-y-full',
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {displayTabs.map((tab) => {
          // Accueil is also the staff's sales dashboard, so it lights up there.
          const forceActive =
            (tab.to === '/dashboard' && onSalesDashboard) ||
            (tab.to === MORE_PATH && plusActive);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive: navActive }) => {
                const isActive = navActive || forceActive;
                return cn(
                  'flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg transition-colors min-w-[60px]',
                  tab.central && 'relative -mt-6',
                  !tab.central && (isActive ? 'text-primary' : 'text-muted-foreground'),
                );
              }}
            >
              {({ isActive: navActive }) => {
                const isActive = navActive || forceActive;
                return tab.central ? (
                  <>
                    {/* Central tab is coloured only while it is the current screen. */}
                    <div
                      className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center transition-colors',
                        isActive ? 'bg-primary shadow-lg shadow-primary/30' : 'bg-card border border-border',
                      )}
                    >
                      <tab.icon className={cn('w-6 h-6', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                    </div>
                    <span className="text-[10px] font-medium mt-0.5">{tab.label}</span>
                  </>
                ) : (
                  <>
                    {/* Active tab: colored pill behind the icon, icon stays
                        light — same treatment as the central QR button above,
                        generalized to every tab instead of just that one. */}
                    <div
                      className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
                        isActive && 'bg-primary',
                      )}
                    >
                      <tab.icon className={cn('w-5 h-5', isActive && 'text-primary-foreground')} />
                    </div>
                    <span className="text-[10px] font-medium">{tab.label}</span>
                  </>
                );
              }}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
