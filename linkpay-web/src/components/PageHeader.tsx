import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
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
}

/**
 * Mobile-first page header: the title always truncates instead of pushing
 * the action button off-screen, and the action itself is a full text+icon
 * button on tablet/desktop (`md:` and up) but a floating icon-only round
 * button on phones — same raised-FAB language BottomNav already uses for
 * its central QR action, just applied to each page's primary action.
 */
export function PageHeader({ title, action }: PageHeaderProps) {
  const Icon = action?.icon;

  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-bold text-foreground truncate min-w-0 flex-1">{title}</h1>

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
              className="md:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full shadow-card-hover"
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
              className="md:hidden fixed bottom-24 right-4 z-40 h-14 w-14 rounded-full shadow-card-hover"
            >
              <Icon className="w-6 h-6" />
            </Button>
          </>
        )
      )}
    </div>
  );
}
