import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
