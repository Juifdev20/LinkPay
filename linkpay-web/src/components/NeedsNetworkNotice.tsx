import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useNeedsNetwork } from '@/lib/network';

/**
 * The line shown when an action that needs the Internet did not get it (lib/api.ts): said plainly, for a few seconds,
 * above the bottom bar. Mounted once, at the root, so it also shows on the login and public pages.
 */
export function NeedsNetworkNotice() {
  const notice = useNeedsNetwork((s) => s.notice);
  const hide = useNeedsNetwork((s) => s.hide);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(hide, 7000);
    return () => window.clearTimeout(t);
  }, [notice, hide]);
  if (!notice) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex justify-center px-4 md:bottom-6">
      <button
        type="button"
        onClick={hide}
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl bg-slate-800 px-4 py-3 text-left text-sm text-white shadow-lg dark:bg-slate-700"
      >
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{notice.text}</span>
      </button>
    </div>
  );
}
