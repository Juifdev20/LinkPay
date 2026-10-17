import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import api from '@/lib/api';
import { COOKIE_AUTH } from '@/lib/auth-mode';
import { playChime, announceAmount } from '@/lib/payment-chime';

const ALERT_TYPES = new Set(['payment_received', 'transfer_received']);
/** Cookie mode has no realtime session: look for new notifications every few seconds instead. */
const POLL_MS = 8_000;

type Row = { id?: string; type?: string; data?: { amount_cents?: number; currency?: string } };
function chimeFor(row: Row) {
  if (!row.type || !ALERT_TYPES.has(row.type)) return;
  playChime();
  if (row.data?.amount_cents != null && row.data?.currency) announceAmount(row.data.amount_cents, row.data.currency);
}

/**
 * Plays a chime + speaks the amount the instant a "you just received money"
 * notification lands for the current user — merchant checkout payments and
 * P2P wallet transfers alike. Hooks the same Realtime channel pattern
 * useRealtimeInvalidate already proves works (see NotificationsBell), but
 * needs the raw inserted row (type + amount), not just an invalidation
 * signal, so it's its own small subscription rather than reusing that
 * generic hook. Fires identically in the web PWA and the Capacitor Android
 * app — this only depends on the row landing in Postgres, not on how (or
 * whether) push delivery happened.
 */
export function usePaymentReceivedAlert(userId: string | undefined) {
  useEffect(() => {
    if (COOKIE_AUTH) {
      if (!userId) return;
      let seen: Set<string> | null = null; // the first poll only learns what already exists: no chime for old notifications
      let stopped = false;
      const poll = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
          const { data } = await api.get('/notifications', { params: { page: 1, limit: 5 } });
          const rows: Row[] = Array.isArray(data) ? data : [];
          if (stopped) return;
          if (seen === null) { seen = new Set(rows.map((r) => r.id!).filter(Boolean)); return; }
          for (const row of [...rows].reverse()) {
            if (row.id && !seen.has(row.id)) { seen.add(row.id); chimeFor(row); }
          }
        } catch { /* offline or signed out: try again next time */ }
      };
      void poll();
      const timer = setInterval(poll, POLL_MS);
      return () => { stopped = true; clearInterval(timer); };
    }
    const client = supabase;
    if (!client || !userId) return;

    const channel = client
      .channel(`payment-alert:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => chimeFor(payload.new as Row),
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [userId]);
}
