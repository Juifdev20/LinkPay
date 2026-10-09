/**
 * Behind a reverse proxy (Render puts exactly one in front of the API) every
 * request reaches Express from the proxy's own address, so the rate limiter —
 * which keys on the client IP — sees ONE client: the global 100 requests/min
 * (and the 10/min on the public quick-pay) becomes a budget shared by all
 * users, and anyone can lock everybody out by spending it.
 *
 * "trust proxy" tells Express how many proxy hops to believe in
 * X-Forwarded-For, so req.ip is the real client. It must match reality: with
 * no proxy in front, trusting it would let a client choose its own "IP" and
 * dodge the limiter. So it is on (1 hop) only in production, and TRUST_PROXY_HOPS
 * overrides it (0 turns it off).
 */
export function resolveTrustProxyHops(env: { NODE_ENV?: string; TRUST_PROXY_HOPS?: string }): number {
  const explicit = env.TRUST_PROXY_HOPS;
  if (explicit !== undefined && explicit.trim() !== '') {
    const hops = Number(explicit);
    return Number.isInteger(hops) && hops >= 0 ? hops : 0;
  }
  return env.NODE_ENV === 'production' ? 1 : 0;
}

export function configureTrustProxy(expressApp: { set: (key: string, value: unknown) => void }, hops: number): void {
  if (hops > 0) expressApp.set('trust proxy', hops);
}
