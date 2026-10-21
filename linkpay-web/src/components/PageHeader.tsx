import { Link, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PageHeaderAction {
  label: string;
  icon: LucideIcon;
  to?: string;
  onClick?: () => void;
}

interface PageHeaderProps {
  title: string;
  action?: PageHeaderAction;
  /** Hide the back button — only for true landing pages (a role's default
   * "Tableau de bord") where there's nothing meaningful to return to. */
  hideBack?: boolean;
}

/**
 * Mobile-first page header: the title always truncates instead of pushing
 * the action button off-screen, and the action itself is a full text+icon
 * button on tablet/desktop (`md:` and up) but a floating icon-only round
 * button on phones — same raised-FAB language BottomNav already uses for
 * its central QR action, just applied to each page's primary action.
 *
 * Also carries the back button for every page that uses this header (same
 * component on mobile and desktop) — navigate(-1) returns to wherever the
 * user actually came from (sidebar, a tile, a notification), unlike a
 * fixed `to` which would ignore how they got here.
 */
export function PageHeader({ title, action, hideBack }: PageHeaderProps) {
  const Icon = action?.icon;
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {!hideBack && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-accent"
            aria-label="Retour"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="min-w-0 truncate text-[22px] font-bold tracking-tight text-foreground md:text-2xl">{title}</h1>
      </div>

      {action && Icon && (
        action.to ? (
          <>
            <Button asChild className="hidden md:inline-flex flex-shrink-0">
              <Link to={action.to}>
                <Icon className="mr-2 w-4 h-4" />
                {action.label}
              </Link>
            </Button>
            <Button
              asChild
              size="icon"
              className="md:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full shadow-brand"
            >
              <Link to={action.to} aria-label={action.label} title={action.label}>
                <Icon className="w-6 h-6" />
              </Link>
            </Button>
          </>
        ) : (
          <>
            <Button onClick={action.onClick} className="hidden md:inline-flex flex-shrink-0">
              <Icon className="mr-2 w-4 h-4" />
              {action.label}
            </Button>
            <Button
              onClick={action.onClick}
              size="icon"
              aria-label={action.label}
              title={action.label}
              className="md:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full shadow-brand"
            >
              <Icon className="w-6 h-6" />
            </Button>
          </>
        )
      )}
    </div>
  );
}
