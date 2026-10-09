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
