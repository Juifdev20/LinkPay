import 'axios';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** The request has its own offline path (lib/network.ts OFFLINE_FALLBACK): no general "needs the Internet" message. */
    offlineFallback?: boolean;
  }
}
