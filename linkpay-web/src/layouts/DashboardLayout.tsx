import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { BottomNav } from '@/components/BottomNav';
import { TopBar } from '@/components/TopBar';
import { NotificationsBell } from '@/components/NotificationsBell';
import { useTheme } from '@/hooks/useTheme';
import { LayoutDashboard, QrCode, Receipt, Wallet, LogOut, Users, UserCog, ShieldCheck, User, Settings, Percent, Building2, UsersRound, Sun, Moon, Menu, Search, X } from 'lucide-react';
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
  const { toggleTheme, effectiveTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const visibleItems = user ? navItems.filter((item) => item.roles.includes(user.role)) : [];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <aside className={cn(
          'hidden md:flex flex-col border-r border-border bg-card transition-all duration-300',
          sidebarCollapsed ? 'w-20' : 'w-64'
        )}>
          <div className="p-6 border-b border-border flex items-center justify-between">
            {!sidebarCollapsed && <Logo size="md" />}
            <Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="h-9 w-9 ml-auto">
              {sidebarCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </Button>
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
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-border">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-3 mb-3 px-3">
                <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">{user?.full_name || user?.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" className={cn('w-full justify-start text-muted-foreground', sidebarCollapsed && 'px-3')} onClick={handleLogout}>
              <LogOut className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span className="ml-2">Déconnexion</span>}
            </Button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {/* Desktop header — search (not yet wired to real search),
              theme toggle, notifications, profile avatar. Mirrors what
              TopBar gives mobile users below. NotificationsBell lives here
              now instead of the sidebar header. */}
          <div className="hidden md:flex items-center justify-between p-4 border-b border-border bg-card sticky top-0 z-40">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative max-w-md w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
                {effectiveTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <NotificationsBell />
              <Link
                to="/dashboard/profile"
                className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center hover:bg-accent transition-colors"
                aria-label="Profil"
              >
                <User className="w-4 h-4 text-muted-foreground" />
              </Link>
            </div>
          </div>

          <TopBar />
          {/* pt-20 clears the fixed TopBar (mobile only, hence md:pt-0 — the
              desktop header above already accounts for its own space in
              the normal flow) */}
          <div className="pt-20 pb-20 md:pt-0 md:pb-0">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  );
}
