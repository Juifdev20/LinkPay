import { useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResultView, ResultCard } from '@/components/ResultView';
import { formatLastOnline, useNetwork, OFFLINE_FALLBACK_TIMEOUT_MS } from '@/lib/network';
import api from '@/lib/api';

/**
 * Screens that move money (send, top up, withdraw, pay, charge a card…) need the server: only it knows the real
 * balance. Opened without network, they show why instead of a form that would fail at the end. Once the screen was
 * opened online it is never swapped out mid-way (a short drop must not wipe what the person typed): the request
 * itself then tells.
 */
export function RequireOnline({ children, what = 'Cette opération' }: { children: ReactNode; what?: string }) {
  const online = useNetwork((s) => s.online);
  const lastOnlineAt = useNetwork((s) => s.lastOnlineAt);
  const navigate = useNavigate();
  const entered = useRef(false);
  if (online) entered.current = true;
  if (entered.current) return <>{children}</>;

  return (
    <ResultCard>
      <ResultView
        tone="waiting"
        icon={WifiOff}
        title="Connexion nécessaire"
        message={
          <>
            {what} a besoin d'Internet : seul le serveur connaît votre solde réel, rien ne part sans lui.
            <span className="mt-2 block">Dernière connexion {formatLastOnline(lastOnlineAt)}. L'écran s'ouvrira dès le retour du réseau.</span>
          </>
        }
      >
        <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => { api.get('/platform/settings', { timeout: OFFLINE_FALLBACK_TIMEOUT_MS }).catch(() => undefined); }}>
          Réessayer
        </Button>
        <Button variant="ghost" className="h-12 w-full rounded-xl" onClick={() => navigate(-1)}>Retour</Button>
      </ResultView>
    </ResultCard>
  );
}
