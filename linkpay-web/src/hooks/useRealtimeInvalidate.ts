import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { COOKIE_AUTH } from '@/lib/auth-mode';

/** Cookie mode has no Supabase realtime session (it would be a second, script-readable login): refresh by polling instead. */
const POLL_MS = 20_000;

/**
 * Subscribes to Postgres changes on `table` (optionally filtered, e.g.
 * `merchant_id=eq.<id>`) and invalidates the given React Query keys whenever
 * a row changes — the REST fetch stays the source of truth, this just
 * triggers an instant refetch instead of waiting for a manual reload or a
 * polling interval.
 */
export function useRealtimeInvalidate(
  table: string,
  filter: string | undefined,
  queryKeys: QueryKey[],
  enabled = true,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (COOKIE_AUTH) {
      if (!enabled || (filter !== undefined && !filter)) return;
      const timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      }, POLL_MS);
      return () => clearInterval(timer);
    }
    const client = supabase;
    if (!client || !enabled || (filter !== undefined && !filter)) return;

    // Unique per mount — React 18 StrictMode (dev only) mounts effects twice
    // in a row, and reusing the same channel name races the teardown of the
    // first instance against the second's `.channel()` call, which throws
    // "cannot add postgres_changes callbacks ... after subscribe()".
    const channel = client
      .channel(`${table}:${filter || 'all'}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => {
          queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled]);
}
