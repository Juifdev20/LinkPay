import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QUERY_CACHE_KEY, cacheStorage, getCachedUser } from './token-storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Must outlive the persisted copy, or restored data is dropped at once.
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Last fetched data, saved on the device: on launch every screen shows what
 * it showed last time at once, and refreshes in the background — instead of
 * a blank screen or a spinner until the server answers. Lives next to the
 * session tokens and is wiped with them (token-storage clearTokens).
 */
export const queryPersister = createSyncStoragePersister({
  storage: cacheStorage(),
  key: QUERY_CACHE_KEY,
  throttleTime: 1000,
});

/** A cache restored for another account is thrown away, never shown. */
export const queryCacheBuster = getCachedUser<{ id: string }>()?.id ?? 'anonyme';

export const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
