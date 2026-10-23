import { Capacitor } from '@capacitor/core';
import { publicOrigin } from '@/lib/share';

/**
 * Opens a page of the ScanLinkPay website. In the Android app it leaves the app for the phone's browser (a page for
 * people, not an app screen — e.g. « Supprimer mon compte », as Google Play wants); on the web it is just a page.
 * Returns false when there is no website address to go to (then the caller shows the page itself).
 */
export function openOnWebsite(path: string): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const origin = publicOrigin();
  if (!/^https?:\/\//.test(origin)) return false;
  // An address outside the app: Capacitor hands it to the phone's browser.
  window.location.href = `${origin}${path}`;
  return true;
}
