import { NavLink } from 'react-router-dom';
import type { NavItem } from '@/lib/nav-items';
import { cn } from '@/lib/utils';

/**
 * The pages of a grouped menu entry (administrators' « Argent », « Comptes »…), as tabs at the top of each of them.
 * Each tab is the page's own address; the counter of a page (withdrawals to send…) shows on its tab.
 */
export function HubTabs({ hub, badgeFor }: { hub: NavItem; badgeFor: (item: NavItem) => number }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 md:px-6 md:pt-6">
      <nav aria-label={hub.label} className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-1 rounded-2xl bg-muted p-1">
          {hub.children!.map((page) => {
            const badge = badgeFor(page);
            return (
              <NavLink
                key={page.to}
                to={page.to}
                end
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                    isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {page.label}
                {!!badge && <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">{badge}</span>}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
