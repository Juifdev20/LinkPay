import api from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * `'unsupported'` covers both "no Push API at all" and, on iOS Safari, "not
 * installed to the Home Screen" — iOS only exposes push to a standalone PWA,
 * never to a normal browser tab, no matter the OS version.
 */
export type PushPermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export function getCurrentPushPermission(): PushPermissionStatus {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Whether this browser currently holds an active push subscription — distinct
 * from `Notification.permission`, which stays 'granted' even after the user
 * unsubscribes (only revoking the permission itself, via browser site
 * settings, changes that).
 */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/**
 * Requests permission (only call this from an explicit user action, e.g. a
 * settings toggle — never on page load, which tanks acceptance rates and can
 * get the origin auto-blocked after repeated dismissals) and registers the
 * subscription with the backend. Returns false without throwing on any
 * failure (unsupported browser, permission denied, network error) — callers
 * just reflect that back into the toggle staying off.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed under TS 5.7+'s generic typed-array lib types, which
        // narrow BufferSource to exclude a SharedArrayBuffer-backed view —
        // purely a typing artifact, the runtime value is a plain Uint8Array
        // the Push API has always accepted here.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
    }

    await api.post('/push-subscriptions', subscription.toJSON());
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await api.delete('/push-subscriptions', { params: { endpoint } });
  } catch {
    // Best-effort — nothing meaningful to recover from here, the toggle
    // just reflects whatever state actually resulted.
  }
}
