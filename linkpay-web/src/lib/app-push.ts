import { Capacitor } from '@capacitor/core';
import * as webPush from './push';
import * as nativePush from './native-push';
import type { PushPermissionStatus } from './push';

export type { PushPermissionStatus };

/**
 * Platform switch for push notifications, mirroring src/lib/app-lock.ts.
 * Web/PWA (iOS included) keeps using Web Push/VAPID (src/lib/push.ts,
 * untouched). The Capacitor Android build registers an FCM token instead
 * (src/lib/native-push.ts) — its WebView has no PushManager.
 *
 * Everything here is async (unlike push.ts's sync isPushSupported/
 * getCurrentPushPermission) since the native permission check is
 * inherently async — callers must await/useEffect this.
 */
const isNative = Capacitor.isNativePlatform();

export async function getCurrentPushPermission(): Promise<PushPermissionStatus> {
  return isNative ? nativePush.getCurrentPushPermission() : Promise.resolve(webPush.getCurrentPushPermission());
}

export async function hasActiveSubscription(): Promise<boolean> {
  return isNative ? nativePush.hasActiveSubscription() : webPush.hasActiveSubscription();
}

export async function subscribeToPush(): Promise<boolean> {
  return isNative ? nativePush.subscribeToPush() : webPush.subscribeToPush();
}

export async function unsubscribeFromPush(): Promise<void> {
  return isNative ? nativePush.unsubscribeFromPush() : webPush.unsubscribeFromPush();
}
