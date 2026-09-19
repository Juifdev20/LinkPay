import { NavLink } from 'react-router-dom';
import { Home, Receipt, QrCode, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSheetStore } from '@/lib/sheet-store';
import { useAuthStore } from '@/lib/auth-store';

// "Profil" moved to TopBar.tsx (top-right icon) — this slot is now the app
// Settings destination, matching what the desktop sidebar already calls it
// (DashboardLayout.tsx's navItems: '/dashboard/settings' → "Paramètres").
// The central "QR" tab's target depends on role — see BottomNav() below.
const tabs: { to: string; label: string; icon: typeof Home; end: boolean; central?: boolean }[] = [
  { to: '/dashboard', label: 'Accueil', icon: Home, end: true },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, end: false },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, end: false },
];

export function BottomNav() {
  // Hidden while a FormSheet is open — the sheet owns the keyboard-aware
  // bottom-of-screen real estate at that point (see FormSheet.tsx /
  // sheet-store.ts). The sheet's own z-index already visually covers this
  // bar, but sliding it fully out of the way too avoids leaving its links
  // focusable/tappable underneath.
  const hidden = useSheetStore((s) => s.isOpen);
  const hasMerchantId = useAuthStore((s) => !!s.user?.merchant_id);

  // A plain client has no merchant_id — "Créer une demande de paiement"
  // (the merchant-only endpoint) would 400 with "No merchant account
  // associated" for them. Their actual "QR" action is scanning to pay.
  const qrTab = hasMerchantId
    ? { to: '/dashboard/payment-requests/new', label: 'QR', icon: QrCode, end: false, central: true }
    : { to: '/dashboard/wallet/scan', label: 'Scanner', icon: QrCode, end: false, central: true };
  const allTabs = [tabs[0], tabs[1], qrTab, tabs[2]];

  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-nav safe-area-bottom transition-transform duration-200',
        hidden && 'translate-y-full',
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {allTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg transition-colors min-w-[60px]',
                tab.central && 'relative -mt-6',
                !tab.central && (isActive ? 'text-primary' : 'text-muted-foreground'),
              )
            }
          >
            {({ isActive }) =>
              tab.central ? (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                    <tab.icon className="w-6 h-6 text-primary-foreground" />
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
              )
            }
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
