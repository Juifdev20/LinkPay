import { useQuery, useQueryClient } from '@tanstack/react-query';

const POLL_INTERVAL_MS = 3000;
// ~20 attempts * 3s ≈ 60s of polling before giving up and showing a
// "still processing" state instead of a false failure — the webhook (or a
// manual refresh) may still resolve it after this.
const MAX_ATTEMPTS = 20;

/**
 * Polls a payment/top-up status endpoint while it stays PENDING — the
 * frontend's fallback for when a CinetPay webhook hasn't arrived yet (or
 * never will, for older transactions initiated before the backend webhook
 * URL fix). Stops polling once a terminal status is reached, or after
 * MAX_ATTEMPTS, exposing `timedOut` so callers can show "still processing"
 * rather than incorrectly claiming failure.
 */
export function usePaymentStatusPoll<T>(
  queryKey: unknown[],
  fetchFn: () => Promise<T>,
  getStatus: (data: T) => string,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey,
    queryFn: fetchFn,
    enabled,
    refetchInterval: (q) => {
      const data = q.state.data as T | undefined;
      if (!data || getStatus(data) === 'PENDING') {
        return q.state.dataUpdateCount >= MAX_ATTEMPTS ? false : POLL_INTERVAL_MS;
      }
      return false;
    },
  });

  // UseQueryResult doesn't expose dataUpdateCount directly (only the raw
  // Query object passed into refetchInterval above does) — read it back from
  // the cache to know how many attempts have happened so far.
  const attempts = queryClient.getQueryState<T>(queryKey)?.dataUpdateCount ?? 0;
  const timedOut = !!query.data && getStatus(query.data) === 'PENDING' && attempts >= MAX_ATTEMPTS;

  return { ...query, timedOut };
}
