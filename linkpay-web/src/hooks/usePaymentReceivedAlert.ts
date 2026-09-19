import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { playChime, announceAmount } from '@/lib/payment-chime';

const ALERT_TYPES = new Set(['payment_received', 'transfer_received']);

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
    const client = supabase;
    if (!client || !userId) return;

    const channel = client
      .channel(`payment-alert:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { type?: string; data?: { amount_cents?: number; currency?: string } };
          if (!row.type || !ALERT_TYPES.has(row.type)) return;
          playChime();
          if (row.data?.amount_cents != null && row.data?.currency) {
            announceAmount(row.data.amount_cents, row.data.currency);
          }
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [userId]);
}
