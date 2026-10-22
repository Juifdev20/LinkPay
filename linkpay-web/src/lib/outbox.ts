import { create } from 'zustand';
import { queryClient } from './query-client';
import { isNetworkError, useNetwork } from './network';

/**
 * The outbox: what was done without network, waiting to reach the server.
 *
 * Rules (same as HotelSaver's synchronisation):
 *  - each operation gets its id on the device; it travels as `client_ref` / Idempotency-Key, so sending it twice
 *    (lost answer, app killed mid-send) never applies it twice on the server;
 *  - operations go out in the order they were made;
 *  - no answer → it stays waiting and goes out at the next chance; server busy (5xx, 429) → retried later, a bit
 *    more slowly each time; refused by the server (4xx) → kept aside with the reason, never retried on its own:
 *    the person decides on the Synchronisation screen (try again or give it up);
 *  - never money: only what the server can accept later without risk (a note in the expense notebook, a cash sale,
 *    a stock movement). Moving money always needs the network.
 * Kept on the device per account, so another account on the same phone never sends someone else's operations.
 */

export type OutboxStatus = 'pending' | 'sending' | 'error';

export interface OutboxOp<P = any> {
  id: string;
  kind: string;
  /** What the person sees in the Synchronisation screen, e.g. "Dépense : Taxi". */
  label: string;
  detail?: string;
  payload: P;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  error?: string;
  nextTryAt?: number;
}

interface Handler {
  send: (op: OutboxOp) => Promise<unknown>;
  /** react-query keys to refresh once an operation of this kind went through. */
  invalidate?: (op: OutboxOp) => unknown[][];
}

const handlers = new Map<string, Handler>();

/** Called once per kind, at module load of the feature that creates such operations. */
export function registerOutboxHandler(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

const storageKey = (userId: string) => `linkpay_outbox_${userId}`;

function load(userId: string | null): OutboxOp[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const ops = raw ? (JSON.parse(raw) as OutboxOp[]) : [];
    // An operation caught "sending" when the app was closed is just waiting again.
    return ops.map((o) => (o.status === 'sending' ? { ...o, status: 'pending' } : o));
  } catch {
    return [];
  }
}

interface OutboxState {
  userId: string | null;
  ops: OutboxOp[];
  flushing: boolean;
  useAccount: (userId: string | null) => void;
}

export const useOutbox = create<OutboxState>((set, get) => ({
  userId: null,
  ops: [],
  flushing: false,
  useAccount: (userId) => {
    if (get().userId === userId) return;
    set({ userId, ops: load(userId) });
  },
}));

function save(ops: OutboxOp[]) {
  const { userId } = useOutbox.getState();
  useOutbox.setState({ ops });
  if (!userId) return;
  try {
    if (ops.length) localStorage.setItem(storageKey(userId), JSON.stringify(ops));
    else localStorage.removeItem(storageKey(userId));
  } catch { /* storage full: kept in memory for this session */ }
}

const patch = (id: string, changes: Partial<OutboxOp>) =>
  save(useOutbox.getState().ops.map((o) => (o.id === id ? { ...o, ...changes } : o)));

export function newClientRef(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/** Puts an operation in the outbox and tries to send it right away. Returns it (its id is the client_ref). */
export function enqueue<P>(kind: string, label: string, payload: P, detail?: string, id = newClientRef()): OutboxOp<P> {
  const op: OutboxOp<P> = { id, kind, label, detail, payload, createdAt: Date.now(), attempts: 0, status: 'pending' };
  save([...useOutbox.getState().ops, op]);
  void flushOutbox();
  return op;
}

export function retryOp(id: string) {
  patch(id, { status: 'pending', error: undefined, nextTryAt: undefined });
  void flushOutbox();
}

export function discardOp(id: string) {
  save(useOutbox.getState().ops.filter((o) => o.id !== id));
}

const backoff = (attempts: number) => Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/** Sends what is waiting, oldest first. Safe to call often: only one run at a time. */
export async function flushOutbox(): Promise<void> {
  const state = useOutbox.getState();
  if (state.flushing || !state.userId) return;
  useOutbox.setState({ flushing: true });
  try {
    const due = state.ops
      .filter((o) => o.status === 'pending' && (!o.nextTryAt || o.nextTryAt <= Date.now()))
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const op of due) {
      const handler = handlers.get(op.kind);
      if (!handler) continue; // its feature is not loaded yet: next run
      patch(op.id, { status: 'sending' });
      try {
        await handler.send(op);
        discardOp(op.id);
        for (const key of handler.invalidate?.(op) ?? []) void queryClient.invalidateQueries({ queryKey: key });
      } catch (err: any) {
        const status: number | undefined = err?.response?.status;
        if (isNetworkError(err) || !status) {
          patch(op.id, { status: 'pending' });
          useNetwork.getState().unreachable();
          break; // no network: the others would fail the same way
        }
        if (status >= 500 || status === 429 || status === 408) {
          const attempts = op.attempts + 1;
          patch(op.id, { status: 'pending', attempts, nextTryAt: Date.now() + backoff(attempts) });
          continue;
        }
        const message = err?.response?.data?.message;
        patch(op.id, { status: 'error', attempts: op.attempts + 1, error: Array.isArray(message) ? message.join(' ') : message || `Refusé par le serveur (${status}).` });
      }
    }
  } finally {
    useOutbox.setState({ flushing: false });
  }
}

export const usePendingOps = () => useOutbox((s) => s.ops);
export const usePendingCount = () => useOutbox((s) => s.ops.length);
export const useFailedCount = () => useOutbox((s) => s.ops.filter((o) => o.status === 'error').length);
