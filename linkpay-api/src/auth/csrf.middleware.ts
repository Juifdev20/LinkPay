import { CSRF_HEADER, CSRF_VALUE, ACCESS_COOKIE, REFRESH_COOKIE, parseCookies } from './auth-cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery protection for cookie sessions. A browser attaches cookies to
 * requests an attacker's page makes, so for any state-changing request that carries our session
 * cookie (and no Authorization header — bearer clients are not exposed to CSRF) we require:
 *   1. our custom header — a foreign page can't add it without a CORS preflight that our
 *      origin allow-list refuses;
 *   2. the request not to be flagged cross-site by the browser (Sec-Fetch-Site);
 *   3. if an Origin is present, that it is one of ours.
 * SameSite=Strict on the cookie is the first line of defence; this is the second.
 */
export function createCsrfMiddleware(allowedOrigins: (string | RegExp)[]) {
  const originAllowed = (origin: string) => allowedOrigins.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));

  return (req: any, res: any, next: () => void) => {
    if (SAFE_METHODS.has(req.method)) return next();
    // Only a real bearer token exempts a request (the cookie is then not what authenticates it): any other
    // Authorization value must not be a way around the checks below.
    if (/^Bearer\s+\S+/i.test(req.headers?.authorization || '')) return next();

    const cookies = parseCookies(req.headers?.cookie);
    if (!cookies[ACCESS_COOKIE] && !cookies[REFRESH_COOKIE]) return next();

    const reject = (why: string) =>
      res.status(403).json({ statusCode: 403, code: 'CSRF_REJECTED', message: `Requête refusée (${why}).` });

    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) return reject('en-tête manquant');
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site') return reject('origine externe');
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !originAllowed(origin)) return reject('origine non autorisée');
    if (origin === 'null') return reject('origine inconnue');
    return next();
  };
}
