import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { BottomNav } from '@/components/BottomNav';
import { NotificationsBell } from '@/components/NotificationsBell';
import { LayoutDashboard, QrCode, Receipt, Wallet, LogOut, Users, UserCog, ShieldCheck, User, Settings, Percent, Building2, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';

const ALL_ROLES = ['merchant', 'cashier', 'enterprise', 'client', 'admin', 'super_admin'];

const navItems = [
  { to: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, roles: ALL_ROLES },
  { to: '/dashboard/payment-requests', label: 'Demandes de paiement', icon: QrCode, roles: ['merchant', 'cashier', 'enterprise'] },
  { to: '/dashboard/transactions', label: 'Transactions', icon: Receipt, roles: ['merchant', 'cashier', 'enterprise'] },
  { to: '/dashboard/settlements', label: 'Règlements', icon: Wallet, roles: ['merchant', 'enterprise'] },
  { to: '/dashboard/team', label: 'Équipe', icon: UsersRound, roles: ['merchant'] },
  { to: '/dashboard/client/transactions', label: 'Mes paiements', icon: Receipt, roles: ALL_ROLES },
  { to: '/dashboard/admin', label: 'Administration', icon: ShieldCheck, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/merchants', label: 'Commerçants', icon: Users, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/settlements', label: 'Règlements (admin)', icon: Wallet, roles: ['admin', 'super_admin'] },
  { to: '/dashboard/admin/users', label: 'Utilisateurs', icon: UserCog, roles: ['super_admin'] },
  { to: '/dashboard/admin/commissions', label: 'Commissions', icon: Percent, roles: ['super_admin'] },
  { to: '/dashboard/organization', label: 'Mon organisation', icon: Building2, roles: ['enterprise'] },
  { to: '/dashboard/settings', label: 'Paramètres', icon: Settings, roles: ALL_ROLES },
];

export default function DashboardLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const visibleItems = user ? navItems.filter((item) => item.roles.includes(user.role)) : [];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <Logo size="md" />
            <NotificationsBell />
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/dashboard'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3 mb-3 px-3">
              <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{user?.full_name || user?.email}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Mobile header */}
          <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card sticky top-0 z-40">
            <Logo size="sm" />
            <NotificationsBell />
          </div>
          <div className="pb-20 md:pb-0">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
}
