import { create } from 'zustand';

/**
 * Is the server reachable right now, and when did we last hear from it?
 *
 * navigator.onLine alone lies (a phone on a Wi-Fi with no internet says "online"), so the API client also reports
 * every answer it gets (reachable) and every request that never got one (unreachable): the truth is whatever happened
 * last. `lastOnlineAt` is kept on the device so the offline banner can say how old the data on screen is, even after
 * the app was closed and reopened without network.
 */
const LAST_ONLINE_KEY = 'linkpay_last_online_at';

const readLastOnline = (): number | null => {
  try {
    const v = Number(localStorage.getItem(LAST_ONLINE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

interface NetworkState {
  online: boolean;
  lastOnlineAt: number | null;
  /** The server answered (any HTTP status). */
  reachable: () => void;
  /** A request got no answer at all (no network, DNS, timeout). */
  unreachable: () => void;
}

export const useNetwork = create<NetworkState>((set, get) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastOnlineAt: readLastOnline(),
  reachable: () => {
    const now = Date.now();
    // Written at most every 10 s: this runs on every API answer.
    const prev = get().lastOnlineAt ?? 0;
    if (now - prev > 10_000) {
      try { localStorage.setItem(LAST_ONLINE_KEY, String(now)); } catch { /* not remembered */ }
      set({ online: true, lastOnlineAt: now });
    } else if (!get().online) {
      set({ online: true });
    }
  },
  unreachable: () => {
    if (get().online) set({ online: false });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => useNetwork.getState().unreachable());
  // "online" only means a network is back, not that the server answers: the next request (the outbox flush, a
  // refetch) confirms it. Shown as online meanwhile so the user can try.
  window.addEventListener('online', () => useNetwork.setState({ online: true }));
}

/**
 * How long a request that can fall back to working offline (a till ticket, a sale, the "is the server back?" probe)
 * waits for an answer. A Wi-Fi without Internet or a very weak 2G does not refuse the connection: it stays silent,
 * and without a limit the cashier would watch a spinner while the customer waits. After this delay the request counts
 * as "no network" (the app goes offline mode, the sale goes on in cash and is sent later).
 */
export const OFFLINE_FALLBACK_TIMEOUT_MS = 10_000;

/** The error of a request that never reached the server (as opposed to a refusal by the server). */
export const isNetworkError = (err: any): boolean => !!err && !err.response && err.code !== 'ERR_CANCELED';

export const useOnline = () => useNetwork((s) => s.online);

/** "22/10 à 14:05", or "aujourd'hui à 14:05". */
export function formatLastOnline(at: number | null): string {
  if (!at) return 'jamais';
  const d = new Date(at);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `aujourd'hui à ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${time}`;
}
