import { Link } from 'react-router-dom';
import { User, Sun, Moon } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { NotificationsBell } from '@/components/NotificationsBell';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

/**
 * Fixed (not just sticky) top bar for mobile — stays perfectly still while
 * page content scrolls underneath, with rounded bottom corners for a
 * floating-card look. Replaces the old in-flow `sticky top-0` mobile header
 * in DashboardLayout. The profile icon here is what used to be BottomNav's
 * "Profil" tab — see BottomNav.tsx, now relabeled "Paramètres".
 */
export function TopBar() {
  const { toggleTheme, effectiveTheme } = useTheme();

  return (
    // Two layers, same convention as BottomNav's `safe-area-bottom`: the
    // outer element only carries the safe-area inset (0 on non-notched
    // phones, extra space above the notch/status bar otherwise), the inner
    // div carries the actual visual padding so the bar never looks cramped
    // on ordinary devices.
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 border-b border-border bg-card shadow-nav rounded-b-3xl safe-area-top">
      <div className="flex items-center justify-between px-4 py-3">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-10 w-10" aria-label="Changer de thème">
            {effectiveTheme === 'dark' ? <Sun className="h-5 w-5 text-muted-foreground" /> : <Moon className="h-5 w-5 text-muted-foreground" />}
          </Button>
          <NotificationsBell />
          <Link
            to="/dashboard/profile"
            className="w-10 h-10 rounded-xl hover:bg-accent flex items-center justify-center transition-colors"
            aria-label="Profil"
          >
            <User className="w-5 h-5 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </div>
  );
}
