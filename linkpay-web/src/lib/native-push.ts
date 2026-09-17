import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import api from './api';
import type { PushPermissionStatus } from './push';

const FCM_TOKEN_KEY = 'linkpay_push_fcm_token';

function mapPermission(state: string): PushPermissionStatus {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  return 'default';
}

export async function getCurrentPushPermission(): Promise<PushPermissionStatus> {
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return mapPermission(receive);
  } catch {
    return 'unsupported';
  }
}

/** Mirrors push.ts's distinction between "permission granted" and "actually
 * registered" — tracked locally since, unlike the Push API, there's no
 * native call to ask "is there currently a live FCM token for this app". */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!localStorage.getItem(FCM_TOKEN_KEY)) return false;
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return receive === 'granted';
  } catch {
    return false;
  }
}

function registerAndGetToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    let regHandle: PluginListenerHandle | undefined;
    let errHandle: PluginListenerHandle | undefined;
    const cleanup = () => {
      regHandle?.remove();
      errHandle?.remove();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('FCM registration timed out'));
    }, 15000);

    PushNotifications.addListener('registration', (token) => {
      clearTimeout(timeout);
      cleanup();
      resolve(token.value);
    }).then((h) => (regHandle = h));

    PushNotifications.addListener('registrationError', (error) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(error.error));
    }).then((h) => (errHandle = h));

    PushNotifications.register();
  });
}

export async function subscribeToPush(): Promise<boolean> {
  try {
    let { receive } = await PushNotifications.checkPermissions();
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      ({ receive } = await PushNotifications.requestPermissions());
    }
    if (receive !== 'granted') return false;

    let token: string;
    try {
      token = await registerAndGetToken();
    } catch (err: any) {
      console.error('[ScanLinkPay push] FCM registration failed:', err?.message || String(err));
      return false;
    }

    try {
      await api.post('/push-subscriptions', { platform: 'android', fcmToken: token });
    } catch (err: any) {
      console.error(
        '[ScanLinkPay push] backend registration failed:',
        err?.response?.status,
        JSON.stringify(err?.response?.data) || err?.message || String(err),
      );
      return false;
    }

    localStorage.setItem(FCM_TOKEN_KEY, token);
    return true;
  } catch (err: any) {
    console.error('[ScanLinkPay push] subscribeToPush failed:', err?.message || String(err));
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const token = localStorage.getItem(FCM_TOKEN_KEY);
  localStorage.removeItem(FCM_TOKEN_KEY);
  try {
    await PushNotifications.unregister();
  } catch {
    // Best-effort, same as the web path.
  }
  if (token) {
    try {
      await api.delete('/push-subscriptions', { params: { fcmToken: token } });
    } catch {
      // Best-effort.
    }
  }
}

// ---- Click-through: deep-link into the app when a delivered notification
// is tapped — the native counterpart of sw.ts's notificationclick handler,
// using the same `data.type` → route mapping. ----
function urlForNotification(data: Record<string, any> | undefined): string {
  const type = data?.type || '';
  if (type.startsWith('wallet_topup') || type.startsWith('transfer')) return '/dashboard/wallet/transactions';
  if (type.startsWith('withdrawal')) return '/dashboard/wallet/transactions';
  if (type.startsWith('payment')) return '/dashboard';
  return '/dashboard';
}

/** Call once at app root (native platforms only) — wires notification taps
 * to in-app navigation. Returns a cleanup function. */
export function initNativePushNavigation(navigate: (path: string) => void): () => void {
  let handle: PluginListenerHandle | undefined;
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    navigate(urlForNotification(action.notification.data));
  }).then((h) => (handle = h));

  return () => {
    handle?.remove();
  };
}
