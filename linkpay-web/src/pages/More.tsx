import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, LogOut } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { navItemsFor } from '@/lib/nav-items';
import { computeVisibleTabs } from '@/components/BottomNav';
import { LogoutConfirmDialog } from '@/components/LogoutConfirmDialog';
import { SECTORS } from '@/pages/organization/OnboardingWizard';

/**
 * The "Plus" tab's destination — a plain page (not a modal or drawer) that
 * lists ONLY the destinations the bottom bar doesn't already show. The
 * visible tabs are computed by the same computeVisibleTabs() the bar uses,
 * so the two can never drift or duplicate: anything already one tap away
 * stays out of this list. Profile card on top, sectioned rows with
 * chevrons below — the classic mobile "More" screen.
 */

// Sections keep the navItems order; each item lands in the FIRST section
// it matches only — otherwise the same entry renders twice. Grouped by
// business domain so a rich module (enterprise) stays scannable.
const SECTIONS: { title: string; match: (to: string) => boolean }[] = [
  {
    title: 'Ventes & stock',
    match: (to) =>
      to.startsWith('/dashboard/organization/sales') ||
      to === '/dashboard/organization/stock' ||
      to === '/dashboard/organization/inventory' ||
      to === '/dashboard/pos',
  },
  {
    title: 'Rapports',
    match: (to) =>
      to === '/dashboard/organization/stats' ||
      to === '/dashboard/organization/audit' ||
      to === '/dashboard/organization/transactions',
  },
  {
    title: 'Services',
    match: (to) =>
      to.startsWith('/dashboard/tontines') ||
      to.startsWith('/dashboard/savings') ||
      to.startsWith('/dashboard/expenses') ||
      to.startsWith('/dashboard/payment-requests') ||
      to.startsWith('/dashboard/team') ||
      to.startsWith('/dashboard/wallet') ||
      to.startsWith('/dashboard/card') ||
      to.startsWith('/dashboard/client/'),
  },
  {
    title: 'Organisation',
    match: (to) =>
      to === '/dashboard/organization/profile' ||
      to === '/dashboard/organization/stores' ||
      to === '/dashboard/organization/staff',
  },
  { title: 'Compte', match: () => true },
];

export default function MorePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Same effective-role rule as DashboardLayout — an org owner "acting as"
  // a store keeps the enterprise menu.
  const role = user?.acting_as_org_id ? 'enterprise' : user?.role;

  // Same queryKey/enabled as DashboardLayout — shares the cache, no
  // extra call. The header card shows the ORGANIZATION (like the
  // reference screen) for org accounts, the user otherwise.
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: user?.role === 'enterprise' || !!user?.organization_id,
  });

  const { displayTabs } = computeVisibleTabs(user, org?.sector);
  const visiblePaths = new Set([
    ...displayTabs.map((t) => t.to),
    '/dashboard/notifications', // already one tap away via the TopBar bell
  ]);

  const moreItems = role
    ? navItemsFor(role, org?.sector).filter((i) => !visiblePaths.has(i.to))
    : [];

  const sections = SECTIONS.map((s) => ({ ...s, items: [] as typeof moreItems }));
  for (const item of moreItems) {
    sections.find((s) => s.match(item.to))?.items.push(item);
  }
  const filledSections = sections.filter((s) => s.items.length > 0);

  const displayName = org?.name || user?.full_name || user?.email || '?';
  const displaySub = org
    ? SECTORS.find((s) => s.value === org.sector)?.label || org.sector
    : role;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6 pb-24">
      {/* Profile card — same leading slot as the reference "More" screens:
          org identity for business accounts, user identity otherwise. */}
      <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-bold text-primary">{initial}</span>
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground truncate">{displayName}</p>
          <p className="text-sm text-muted-foreground capitalize truncate">{displaySub}</p>
        </div>
      </div>

      {filledSections.map((section) => (
        <div key={section.title}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            {section.title}
          </p>
          <nav className="rounded-2xl border border-border bg-card overflow-hidden">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-0 transition-colors ${
                    isActive ? 'bg-primary/5 text-primary' : 'text-foreground hover:bg-accent/50'
                  }`
                }
              >
                <item.icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 text-sm font-medium">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </NavLink>
            ))}
          </nav>
        </div>
      ))}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Session</p>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-destructive hover:bg-destructive/5 transition-colors"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="flex-1 text-sm font-medium text-left">Déconnexion</span>
          </button>
        </div>
      </div>

      <LogoutConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          void logout().then(() => navigate('/'));
        }}
      />
    </div>
  );
}
