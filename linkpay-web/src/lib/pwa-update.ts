import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker and makes new deployments apply themselves —
 * nobody should ever need to manually refresh (or close/reopen the app) to
 * get the latest version.
 *
 * - Checks for a new build every 60s while the app is open, on top of the
 *   checks the browser already does on navigation.
 * - The moment a new version is found, it's activated and the page reloads
 *   itself immediately — fully silent, no prompt.
 *
 * Only wired up in production: in dev, Vite's own HMR already gives instant
 * updates, and there is no built service worker to register.
 */
export function setupAutoUpdate() {
  if (!import.meta.env.PROD) return;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => null);
      }, 60_000);
    },
    onNeedRefresh() {
      updateSW(true);
    },
  });
}
