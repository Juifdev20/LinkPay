import { NavLink } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useAuthStore } from '@/lib/auth-store';
import { navItems } from '@/lib/nav-items';
import { computeVisibleTabs } from '@/components/BottomNav';

/**
 * The "Plus" tab's destination — a plain page (not a modal or drawer) that
 * lists ONLY the destinations the bottom bar doesn't already show. The
 * visible tabs are computed by the same computeVisibleTabs() the bar uses,
 * so the two can never drift or duplicate: anything already one tap away
 * stays out of this list (Paramètres, secondary modules…).
 */
export default function MorePage() {
  const user = useAuthStore((s) => s.user);
  // Same effective-role rule as DashboardLayout — an org owner "acting as"
  // a store keeps the enterprise menu.
  const role = user?.acting_as_org_id ? 'enterprise' : user?.role;

  const { displayTabs } = computeVisibleTabs(user);
  const visiblePaths = new Set([
    ...displayTabs.map((t) => t.to),
    '/dashboard/notifications', // already one tap away via the TopBar bell
  ]);

  const moreItems = role
    ? navItems.filter((i) => i.roles.includes(role) && !visiblePaths.has(i.to))
    : [];

  return (
    <div className="p-6 max-w-lg mx-auto">
      <PageHeader title="Plus" />

      <nav className="rounded-2xl border border-border bg-card overflow-hidden">
        {moreItems.map((item) => (
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
        {moreItems.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">
            Toutes les sections sont déjà dans la barre du bas.
          </p>
        )}
      </nav>
    </div>
  );
}
