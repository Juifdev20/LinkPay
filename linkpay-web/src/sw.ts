/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope & typeof globalThis & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ---- Precaching (replaces generateSW's automatic precache) ----
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ---- Supabase runtime caching (re-implemented from the old workbox.runtimeCaching rule) ----
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({
    cacheName: 'supabase-api',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 300 })],
  }),
);

// ---- Keep the existing silent-auto-update UX working ----
// Under generateSW + registerType:'autoUpdate', skipWaiting/clientsClaim are
// injected automatically. injectManifest requires this by hand, or
// pwa-update.ts's updateSW(true) call silently stops reloading tabs.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ---- Web Push ----
interface PushPayload {
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
}

// TS's bundled lib.dom types don't yet include `vibrate` on
// NotificationOptions, even though it's part of the live spec and supported
// by Chrome/Edge on Android — extend the type locally rather than `any`.
interface ExtendedNotificationOptions extends NotificationOptions {
  vibrate?: number[];
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = { title: 'LinkPay', body: '', type: '' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Non-JSON payload — fall back to plain text in the body.
    payload = { title: 'LinkPay', body: event.data?.text() || '', type: '' };
  }

  const options: ExtendedNotificationOptions = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // Android-only — iOS Safari ignores `vibrate` entirely (even on an
    // installed PWA), desktop has no vibration motor. Harmless no-op there,
    // real UX win on Android.
    vibrate: [200, 100, 200],
    data: { type: payload.type, ...payload.data },
  };

  event.waitUntil(self.registration.showNotification(payload.title || 'LinkPay', options));
});

// ---- Click-through: focus an existing tab or open a new one, deep-linked ----
function urlForNotification(data: Record<string, any> | undefined): string {
  const type = data?.type || '';
  if (type.startsWith('wallet_topup') || type.startsWith('transfer')) return '/dashboard/wallet';
  if (type.startsWith('withdrawal')) return '/dashboard/wallet/transactions';
  if (type.startsWith('payment')) return '/dashboard';
  return '/dashboard';
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetPath = urlForNotification(event.notification.data);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          await (client as WindowClient).focus();
          if ('navigate' in client) await (client as WindowClient).navigate(targetPath);
          return;
        }
      }
      await self.clients.openWindow(targetPath);
    })(),
  );
});
