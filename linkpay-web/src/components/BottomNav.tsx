import { NavLink, useLocation } from 'react-router-dom';
import { Home, Receipt, QrCode, Settings, ShoppingCart, Boxes, BarChart3, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSheetStore } from '@/lib/sheet-store';
import { useAuthStore } from '@/lib/auth-store';

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

const staffTabs: Record<string, Tab[]> = {
  vendeur: [homeTab, stockTab, salesTab, settingsTab],
  caissier: [homeTab, orgTransactionsTab, salesTab, settingsTab],
  comptable: [homeTab, orgTransactionsTab, financeTab, settingsTab],
  magasinier: [homeTab, stockTab, alertsTab, settingsTab],
};

export function BottomNav() {
  // Hidden while a FormSheet is open — the sheet owns the keyboard-aware
  // bottom-of-screen real estate at that point (see FormSheet.tsx /
  // sheet-store.ts). The sheet's own z-index already visually covers this
  // bar, but sliding it fully out of the way too avoids leaving its links
  // focusable/tappable underneath.
  const hidden = useSheetStore((s) => s.isOpen);
  const hasMerchantId = useAuthStore((s) => !!s.user?.merchant_id);
  const isEnterprise = useAuthStore((s) => s.user?.role === 'enterprise');
  const role = useAuthStore((s) => s.user?.role);
  const { pathname } = useLocation();
  const onSalesDashboard = pathname === SALES_DASHBOARD_PATH;

  // A plain client has no merchant_id — "Créer une demande de paiement"
  // (the merchant-only endpoint) would 400 with "No merchant account
  // associated" for them. Their central action is showing their own QR/
  // number to get paid (same screen as the "Recevoir" quick action on the
  // dashboard) — scanning someone else's QR to pay remains available from
  // that same quick-action grid, this tab just isn't it. An enterprise
  // owner has neither merchant_id (unless "acting as" a store) nor a
  // personal wallet relevant here — their QR/number is the organization's,
  // not /dashboard/wallet/receive's personal one, and their "Transactions"
  // tab means the whole business's sales, not a single store's (which
  // /dashboard/transactions would 400 on anyway, no merchant_id).
  const qrTab = isEnterprise
    ? { to: '/dashboard/organization/receive', label: 'Recevoir', icon: QrCode, end: false, central: true }
    : hasMerchantId
    ? { to: '/dashboard/payment-requests/new', label: 'QR', icon: QrCode, end: false, central: true }
    : { to: '/dashboard/wallet/receive', label: 'Recevoir', icon: QrCode, end: false, central: true };
  const transactionsTab = isEnterprise
    ? { ...tabs[1], to: '/dashboard/organization/transactions' }
    : tabs[1];
  const allTabs = staffTabs[role || ''] ?? [tabs[0], transactionsTab, qrTab, tabs[2]];

  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-nav safe-area-bottom transition-transform duration-200',
        hidden && 'translate-y-full',
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {allTabs.map((tab) => {
          // Accueil is also the staff's sales dashboard, so it lights up there.
          const forceActive = tab.to === '/dashboard' && onSalesDashboard;
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
