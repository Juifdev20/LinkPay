import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Building2, LogOut, User, X } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useDrawerStore } from '@/lib/drawer-store';
import { navItems } from '@/lib/nav-items';
import { SECTORS } from '@/pages/organization/OnboardingWizard';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { LogoutConfirmDialog } from '@/components/LogoutConfirmDialog';
import { cn } from '@/lib/utils';

/**
 * Mobile equivalent of the desktop sidebar (DashboardLayout.tsx's
 * `<aside>`) — same navItems list (shared via lib/nav-items.ts), same
 * active-state styling, same footer. Business modules (Stock &
 * Approvisionnement, Transactions, Utilisateurs internes, etc.) live here,
 * not in Settings — Settings is for account configuration only (e.g.
 * "Profil entreprise"), per product decision: a module isn't "config".
 *
 * Rendered as a BOTTOM SHEET, not a left drawer — this is the "Plus" tab's
 * content (BottomNav.tsx), and a slide-in sidebar is exactly what mobile
 * users recognize as "the desktop menu", which this app deliberately
 * doesn't have.
 *
 * Opened by BottomNav's "Plus" tab and TopBar.tsx's hamburger button via
 * drawer-store.ts. `org` is passed in from DashboardLayout (already
 * fetched there) rather than re-queried.
 */
export function MobileNavDrawer({ org }: { org?: any }) {
  const isOpen = useDrawerStore((s) => s.isOpen);
  const close = useDrawerStore((s) => s.close);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const visibleItems = user ? navItems.filter((item) => item.roles.includes(user.role)) : [];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Belt-and-suspenders close-on-navigate: each NavLink below also closes
  // directly via its own onClick, but reacting to the route itself here
  // guarantees the drawer never lingers open over the new page regardless
  // of how navigation was triggered. Skips the very first render (ref
  // starts at the current path) so mounting the drawer doesn't immediately
  // fire a close on an already-closed drawer for no reason.
  const location = useLocation();
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== lastPath.current) {
      lastPath.current = location.pathname;
      close();
    }
  }, [location.pathname, close]);

  return (
    <>
      <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="md:hidden fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
          <DialogPrimitive.Content className="md:hidden fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] bg-card border-t border-border rounded-t-3xl flex flex-col safe-area-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom">
            <DialogPrimitive.Title className="sr-only">Plus</DialogPrimitive.Title>

            {/* Drag-handle look — the visual cue for a bottom sheet. */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            <div className="px-6 pb-4 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <Logo size="md" />
                <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent transition-colors" aria-label="Fermer">
                  <X className="w-4 h-4" />
                </DialogPrimitive.Close>
              </div>
              {/* Which organization/store this menu belongs to — pulled
                  live, never hardcoded, same as the desktop sidebar. */}
              {org && (
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
                  onClick={close}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="p-4 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-3 mb-3 px-3">
                <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">{user?.full_name || user?.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setShowLogoutConfirm(true)}>
                <LogOut className="w-4 h-4 flex-shrink-0" />
                <span className="ml-2">Déconnexion</span>
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          close();
          handleLogout();
        }}
      />
    </>
  );
}
