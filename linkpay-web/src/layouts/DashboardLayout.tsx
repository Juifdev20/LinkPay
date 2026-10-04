import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { BottomNav } from '@/components/BottomNav';
import { TopBar } from '@/components/TopBar';
import { NotificationsBell } from '@/components/NotificationsBell';
import { LogoutConfirmDialog } from '@/components/LogoutConfirmDialog';
import { MobileNavDrawer } from '@/components/MobileNavDrawer';
import { useTheme } from '@/hooks/useTheme';
import { usePaymentReceivedAlert } from '@/hooks/usePaymentReceivedAlert';
import { LogOut, User, Building2, Sun, Moon, Menu, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTORS } from '@/pages/organization/OnboardingWizard';
import { navItems } from '@/lib/nav-items';

export default function DashboardLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const exitStore = useAuthStore((s) => s.exitStore);
  const navigate = useNavigate();
  const { toggleTheme, effectiveTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  usePaymentReceivedAlert(user?.id);

  // Same query key as OrganizationProfile.tsx's `my-organization` — react-query
  // dedupes/shares the cache, so this doesn't add a second network call once
  // that page (or the onboarding wizard it renders) has already fetched it.
  // Enabled for org-staff too (not just the owner) — /organizations/me
  // resolves for them via their organization_id claim, and they should see
  // which company they belong to in the sidebar just like the owner does.
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: user?.role === 'enterprise' || !!user?.organization_id,
  });
  const navLocked = user?.role === 'enterprise' && !!org && org.status !== 'active';

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const handleLogout = async () => {
    // Must await — logout() is async (it clears auth state only after its
    // own API call settles). Firing navigate('/') right away raced that:
    // RootRedirect would still see isAuthenticated === true for a moment
    // and bounce straight back to /dashboard, making the button look dead.
    await logout();
    navigate('/');
  };

  const visibleItems = user ? navItems.filter((item) => item.roles.includes(user.role)) : [];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-screen">
        {/* Desktop sidebar — hidden entirely (not just dimmed) while an
            enterprise account hasn't finished onboarding/validation, same
            reasoning as the mobile BottomNav below: none of these
            destinations are usable yet, so there's nothing to navigate to. */}
        {!navLocked && (
          <aside className={cn(
            'hidden md:flex flex-col border-r border-border bg-card transition-all duration-300',
            sidebarCollapsed ? 'w-20' : 'w-64'
          )}>
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                {!sidebarCollapsed && <Logo size="md" />}
                <Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="h-9 w-9 ml-auto">
                  {sidebarCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </Button>
              </div>
              {/* Which organization/store this sidebar belongs to — pulled
                  live from the org query below, never hardcoded, since the
                  same layout serves every enterprise account. */}
              {!sidebarCollapsed && org && (
                <div className="mt-3 flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{org.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {SECTORS.find((s) => s.value === org.sector)?.label || org.sector}
                    </p>
                  </div>
                </div>
              )}
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
              <Button variant="ghost" size="sm" className={cn('w-full justify-start text-muted-foreground', sidebarCollapsed && 'px-3')} onClick={() => setShowLogoutConfirm(true)}>
                <LogOut className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span className="ml-2">Déconnexion</span>}
              </Button>
            </div>
          </aside>
        )}

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
            {/* Only shown while "acting as" a store entered from the org
                dashboard (acting_as_org_id) — not role-based, since role is
                'merchant' in that state, indistinguishable from a real
                merchant account otherwise. The only way back. */}
            {user?.acting_as_org_id && (
              <div className="px-6 pt-4 md:px-4 md:pt-4">
                <button
                  onClick={() => {
                    exitStore();
                    navigate('/dashboard');
                  }}
                  className="w-full flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  <Building2 className="w-4 h-4" />
                  Retour à l'organisation
                </button>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom nav + nav drawer — both hidden entirely (not just
          dimmed) while an enterprise account hasn't finished onboarding,
          since none of these destinations are usable yet. */}
      {!navLocked && <BottomNav />}
      {!navLocked && <MobileNavDrawer org={org} />}

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
      />
    </div>
  );
}
