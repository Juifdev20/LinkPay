import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, Suspense } from 'react';
import { PageFallback } from '@/lib/lazy-page';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { BottomNav } from '@/components/BottomNav';
import { TopBar } from '@/components/TopBar';
import { NotificationsBell } from '@/components/NotificationsBell';
import { LogoutConfirmDialog } from '@/components/LogoutConfirmDialog';
import { UserAvatar } from '@/components/UserAvatar';
import { CardChargePrompt } from '@/components/card/CardChargePrompt';
import { OfflineBanner } from '@/components/OfflineBanner';
import { GlobalSearch } from '@/components/GlobalSearch';
import { useTheme } from '@/hooks/useTheme';
import { usePaymentReceivedAlert } from '@/hooks/usePaymentReceivedAlert';
import { LogOut, Building2, Sun, Moon, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTORS } from '@/pages/organization/OnboardingWizard';
import { groupNavItems, navItemsFor, SYNC_NAV_ITEM, type NavItem } from '@/lib/nav-items';
import { usePendingCount } from '@/lib/outbox';
import { ROLE_LABELS } from '@/lib/permissions';

export default function DashboardLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const exitStore = useAuthStore((s) => s.exitStore);
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleTheme, effectiveTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  // Admins: how many withdrawals wait to be sent by hand (badge on "Retraits à traiter").
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const { data: openWithdrawals } = useQuery<{ open: number }>({
    queryKey: ['admin-withdrawals-count'],
    queryFn: async () => (await api.get('/admin/withdrawals/count')).data,
    enabled: isAdmin,
    refetchInterval: 60000,
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

  // An org owner "acting as" one of their stores carries role 'merchant' +
  // acting_as_org_id (auth-store enterStore). For navigation purposes they
  // keep the enterprise/supermarket menu — they are the owner inside their
  // store, not a standalone merchant.
  const navRole = user?.acting_as_org_id ? 'enterprise' : user?.role;
  const roleItems = user && navRole ? navItemsFor(navRole, org?.sector) : [];
  // Synchronisation lives in Paramètres; it joins the sidebar only while operations made offline wait to be sent.
  const pendingOps = usePendingCount();
  const navGroups = groupNavItems(pendingOps && roleItems.length ? [...roleItems, SYNC_NAV_ITEM] : roleItems);
  const badgeFor = (item: NavItem) =>
    item.to === '/dashboard/admin/withdrawals' ? openWithdrawals?.open || 0 : item.to === SYNC_NAV_ITEM.to ? pendingOps : 0;

  return (
    <div className="h-[100dvh] bg-background">
      {/* The visible height (dvh), not 100vh: on Android 100vh can exceed the screen and let the page itself scroll. */}
      <div className="flex h-[100dvh]">
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
                      {/* Staff see the one station they work in; the owner the sector. */}
                      {user?.station_name || SECTORS.find((s) => s.value === org.sector)?.label || org.sector}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Grouped by what the entries are for (lib/nav-items.ts NAV_SECTIONS): selling first, then follow-up,
                stock, the business, the person's own account; Notifications and Paramètres always at the bottom. */}
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              {navGroups.map((group, gi) => (
                <div key={group.id} className={cn(gi > 0 && 'mt-4', group.id === 'system' && 'pt-4 border-t border-border')}>
                  {group.title && !sidebarCollapsed && (
                    <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group.title}</p>
                  )}
                  {group.title && sidebarCollapsed && <div className="mx-3 mb-3 border-t border-border" />}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const badge = badgeFor(item);
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          // Exact match when another entry lives under it (Administration / Retraits à traiter,
                          // Ventes / Historique des ventes, Ma carte / Encaisser par carte): only one entry lit at a time.
                          end={roleItems.some((o) => o.to !== item.to && o.to.startsWith(`${item.to}/`))}
                          className={({ isActive }) =>
                            cn(
                              'relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                              isActive
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            )
                          }
                          title={sidebarCollapsed ? item.label : undefined}
                        >
                          <item.icon className="w-5 h-5 flex-shrink-0" />
                          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                          {!!badge && (
                            <span className={cn('ml-auto rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground', sidebarCollapsed && 'absolute right-1 top-1 ml-0 px-1.5')}>
                              {badge}
                            </span>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="p-4 border-t border-border">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-3 mb-3 px-3">
                  <UserAvatar className="w-9 h-9" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate text-foreground">{user?.full_name || user?.email}</p>
                    {/* role 'merchant' here would be misleading — an org
                        owner inside a store still IS the enterprise owner. */}
                    <p className="text-xs text-muted-foreground capitalize">
                      {user?.acting_as_org_id ? 'Responsable · en station' : (user?.role && ROLE_LABELS[user.role]) || user?.role}
                    </p>
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
        <main className="flex-1 overflow-y-auto overscroll-contain">
          {/* Desktop header — page search (Ctrl+K),
              theme toggle, notifications, profile avatar. Mirrors what
              TopBar gives mobile users below. NotificationsBell lives here
              now instead of the sidebar header. */}
          <div className="hidden md:flex items-center justify-between p-4 border-b border-border bg-card sticky top-0 z-40">
            <div className="flex items-center gap-4 flex-1">
              <GlobalSearch items={roleItems} />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
                {effectiveTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <NotificationsBell />
              <Link to="/dashboard/profile" className="rounded-full" aria-label="Profil">
                <UserAvatar className="w-9 h-9" />
              </Link>
            </div>
          </div>

          <TopBar />
          {/* topbar-offset pushes content below the fixed TopBar:
              68 px of visual bar + env(safe-area-inset-top) for the Android
              status bar in edge-to-edge mode. Resets to 0 on md: (desktop). */}
          <div className="topbar-offset pb-20 md:pb-0">
            {/* Offline / synchronisation strip — sticks just below the TopBar
                on mobile (topbar-sticky) and below the desktop header. */}
            <div className="sticky topbar-sticky z-30">
              <OfflineBanner />
            </div>
            {/* Only shown while "acting as" a store entered from the org
                dashboard (acting_as_org_id) — not role-based, since role is
                'merchant' in that state, indistinguishable from a real
                merchant account otherwise. Kept on the dashboard page only:
                on work screens (caisse, stock, …) it would just eat ~60px
                of vertical space on every visit. */}
            {user?.acting_as_org_id && location.pathname.startsWith('/dashboard/organization') && (
              <div className="px-6 pt-4 md:px-4 md:pt-4">
                <button
                  onClick={async () => {
                    // Wait for the owner session to be back before leaving the store's screens.
                    await exitStore().catch(() => undefined);
                    navigate('/dashboard');
                  }}
                  className="w-full flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  <Building2 className="w-4 h-4" />
                  Retour à l'organisation
                </button>
              </div>
            )}
            {/* Only the page area waits for a split page — header and nav stay. */}
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {/* A merchant scanned this person's card: the request to confirm with their PIN appears wherever they are. */}
      <CardChargePrompt />

      {/* Mobile bottom nav — hidden entirely (not just dimmed) while an
          enterprise account hasn't finished onboarding, since none of
          these destinations are usable yet. */}
      {!navLocked && <BottomNav />}

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
