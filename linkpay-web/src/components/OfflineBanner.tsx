import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, Wifi, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { useNetwork } from '@/lib/network';
import { useOutbox } from '@/lib/outbox';
import { cn } from '@/lib/utils';

/**
 * The thin strip under the top bar that says what the app is doing with the network:
 *  - offline: the data on screen is the one saved at the last connection, and when that was;
 *  - operations waiting or refused: how many, and a way to the Synchronisation screen;
 *  - back online: a short "De nouveau en ligne".
 * Nothing at all when everything is normal.
 */
export function OfflineBanner() {
  const online = useNetwork((s) => s.online);
  const lastOnlineAt = useNetwork((s) => s.lastOnlineAt);
  const ops = useOutbox((s) => s.ops);
  const failed = ops.filter((o) => o.status === 'error').length;
  const waiting = ops.length - failed;

  const [justBack, setJustBack] = useState(false);
  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) { wasOffline.current = true; return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setJustBack(true);
    const t = window.setTimeout(() => setJustBack(false), 3000);
    return () => window.clearTimeout(t);
  }, [online]);

  let tone = '';
  let icon = WifiOff;
  let text = '';
  let link = false;
  if (!online) {
    tone = 'bg-slate-800 text-white dark:bg-slate-700';
    text = `Hors ligne · ${shortAge(lastOnlineAt)}${waiting ? ` · ${waiting} en attente` : ''}`;
    link = ops.length > 0;
  } else if (failed) {
    tone = 'bg-destructive text-destructive-foreground';
    icon = AlertTriangle;
    text = `${failed} opération${failed > 1 ? 's' : ''} refusée${failed > 1 ? 's' : ''} par le serveur`;
    link = true;
  } else if (waiting) {
    tone = 'bg-primary text-primary-foreground';
    icon = RefreshCw;
    text = `Synchronisation de ${waiting} opération${waiting > 1 ? 's' : ''}…`;
    link = true;
  } else if (justBack) {
    tone = 'bg-success text-success-foreground';
    icon = Wifi;
    text = 'De nouveau en ligne';
  } else {
    return null;
  }

  const Icon = icon;
  const body = (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', icon === RefreshCw && 'animate-spin')} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {link && <span className="flex shrink-0 items-center font-semibold">Voir <ChevronRight className="h-4 w-4" /></span>}
    </>
  );
  const cls = cn('flex items-center gap-2 px-4 py-2 text-[13px] font-medium md:px-6', tone);
  return link ? (
    <Link to="/dashboard/sync" role="status" className={cls}>{body}</Link>
  ) : (
    <div role="status" className={cls}>{body}</div>
  );
}

/** "données de 14:05" today, "données du 21/10" before: short enough for one line on a phone. */
function shortAge(at: number | null): string {
  if (!at) return 'aucune donnée récente';
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? `données de ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    : `données du ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}
