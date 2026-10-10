/**
 * The payment page address comes from the API. Only a normal https address is followed: if the
 * answer were ever wrong or tampered with (a compromised provider integration, a bad proxy), the
 * app must not send the person to a `javascript:`, `data:` or plain-http page.
 */
export function checkoutUrl(url: unknown): string {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:') return u.toString();
  } catch { /* not a URL */ }
  throw new Error('Lien de paiement invalide');
}

/** Our own "payment result" pages: they only ask the API what happened, so they can be shown inside the app. */
const OWN_RESULT_PAGES = ['/dashboard/wallet/topup/result', '/dashboard/expenses/pro/result', '/payment/result'];

/**
 * Where to go after the API returned a payment address. Mobile Money has no payment page of the provider: the address
 * is OUR result page on the website. The Android app contains the site itself, so a full navigation to the website's
 * address would open the phone's browser, where the person is not signed in (a login page instead of the result).
 * Those pages are therefore opened inside the app, through the router. Anything else (the card payment page of the
 * provider) is a normal https address followed as before.
 */
export function followCheckout(url: unknown, navigate: (to: string) => void): void {
  const target = new URL(checkoutUrl(url));
  let siteHost = '';
  try { siteHost = new URL(import.meta.env.VITE_PUBLIC_WEB_URL || window.location.origin).host; } catch { /* unusable setting: external */ }
  if ((target.host === siteHost || target.host === window.location.host) && OWN_RESULT_PAGES.includes(target.pathname)) {
    navigate(`${target.pathname}${target.search}`);
    return;
  }
  window.location.href = target.toString();
}
