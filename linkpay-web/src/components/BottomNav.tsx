import { NavLink } from 'react-router-dom';
import { Home, Receipt, QrCode, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/dashboard', label: 'Accueil', icon: Home, end: true },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, end: false },
  { to: '/dashboard/payment-requests/new', label: 'QR', icon: QrCode, end: false, central: true },
  { to: '/dashboard/settings', label: 'Profil', icon: User, end: false },
];

export function BottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-nav safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg transition-colors min-w-[60px]',
                tab.central && 'relative -mt-6',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            {tab.central ? (
              <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                <tab.icon className="w-6 h-6 text-primary-foreground" />
              </div>
            ) : (
              <tab.icon className="w-5 h-5" />
            )}
            <span className={cn('text-[10px] font-medium', tab.central && 'mt-0.5')}>
              {tab.label}
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
