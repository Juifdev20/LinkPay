import { useEffect } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { useNetwork, OFFLINE_FALLBACK_TIMEOUT_MS } from '@/lib/network';
import { flushOutbox, useOutbox } from '@/lib/outbox';
import api from '@/lib/api';

/**
 * Mounted once (App): binds the outbox to the signed-in account and sends what waits — at start, when the network
 * comes back, and every 20 s while something is waiting (a retry after a server hiccup has its own delay).
 * Also the one that notices the server is back when the browser never said it was gone.
 */
export function useOutboxRunner() {
  const userId = useAuthStore((s) => (s.isAuthenticated ? s.user?.id ?? null : null));
  const online = useNetwork((s) => s.online);
  const waiting = useOutbox((s) => s.ops.some((o) => o.status === 'pending'));

  useEffect(() => {
    useOutbox.getState().useAccount(userId);
  }, [userId]);

  useEffect(() => {
    if (userId && online) void flushOutbox();
  }, [userId, online]);

  // Offline: knock on the server every 15 s (a tiny public request); its answer flips the app back online.
  useEffect(() => {
    if (online) return;
    const t = window.setInterval(() => { api.get('/platform/settings', { timeout: OFFLINE_FALLBACK_TIMEOUT_MS }).catch(() => undefined); }, 15_000);
    return () => window.clearInterval(t);
  }, [online]);

  useEffect(() => {
    if (!userId || !waiting) return;
    const t = window.setInterval(() => void flushOutbox(), 20_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void flushOutbox(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [userId, waiting]);
}
