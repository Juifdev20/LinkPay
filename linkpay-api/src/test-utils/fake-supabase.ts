/**
 * Minimal stand-in for the Supabase client in unit tests: every query
 * (`from(table)...` or `rpc(fn, args)`) is recorded as a list of chained
 * calls and answered by the test's `respond` function.
 */
export type RecordedQuery = { target: string; calls: { method: string; args: any[] }[] };
export type Responder = (q: RecordedQuery) => { data?: any; error?: any; count?: number } | undefined;

export function createFakeSupabase(respond: Responder) {
  const queries: RecordedQuery[] = [];

  const builder = (target: string, first?: { method: string; args: any[] }) => {
    const q: RecordedQuery = { target, calls: first ? [first] : [] };
    queries.push(q);
    const proxy: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            const result = { data: null, error: null, ...(respond(q) || {}) };
            return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
          }
          return (...args: any[]) => {
            q.calls.push({ method: prop, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const client = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: any) => builder(`rpc:${fn}`, { method: 'rpc', args: [args] }),
  };

  return {
    service: { getClient: () => client, getAuthClient: () => client } as any,
    queries,
  };
}

export const has = (q: RecordedQuery, method: string, ...args: any[]) =>
  q.calls.some((c) => c.method === method && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)));
