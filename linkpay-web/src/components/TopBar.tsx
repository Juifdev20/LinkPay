import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { NotificationsBell } from '@/components/NotificationsBell';
import { UserAvatar } from '@/components/UserAvatar';

/**
 * Fixed (not just sticky) top bar for mobile — stays perfectly still while
 * page content scrolls underneath, with rounded bottom corners for a
 * floating-card look. Replaces the old in-flow `sticky top-0` mobile header
 * in DashboardLayout. The profile icon here is what used to be BottomNav's
 * "Profil" tab — see BottomNav.tsx, now relabeled "Paramètres".
 *
 * No hamburger — the app deliberately has no sidebar on mobile; everything
 * beyond the bottom bar's tabs lives on the "Plus" page (see More.tsx).
 * No theme toggle here — it lives in Settings ("Général" card, same pattern
 * as the push-notification toggle) instead, matching the desktop header's
 * spot for it being left as its own independent quick-access affordance.
 */
export function TopBar() {
  return (
    // Two layers, same convention as BottomNav's `safe-area-bottom`: the
    // outer element only carries the safe-area inset (0 on non-notched
    // phones, extra space above the notch/status bar otherwise), the inner
    // div carries the actual visual padding so the bar never looks cramped
    // on ordinary devices.
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-b border-border safe-area-top">
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Logo size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <NotificationsBell />
          <Link to="/dashboard/profile" className="rounded-full transition-transform active:scale-95" aria-label="Profil">
            <UserAvatar />
          </Link>
        </div>
      </div>
    </div>
  );
}
