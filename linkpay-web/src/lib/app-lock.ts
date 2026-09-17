import { Capacitor } from '@capacitor/core';
import * as webauthn from './webauthn';
import * as nativeBiometric from './native-biometric';

/**
 * Platform switch for the App Lock feature. Web/PWA (iOS included) keeps
 * using WebAuthn against the backend (src/lib/webauthn.ts, untouched). The
 * Capacitor Android build uses a local-only native biometric gate instead
 * (src/lib/native-biometric.ts) — there's already a valid JWT session by
 * the time this runs, so there's nothing to enroll/verify server-side.
 *
 * Consumers (AppLockGate, Settings) import from here instead of
 * './webauthn' directly, and never need to know which path is active.
 */
const isNative = Capacitor.isNativePlatform();

export const isAppLockEnabled = isNative ? nativeBiometric.isAppLockEnabled : webauthn.isAppLockEnabled;
export const enableAppLock = isNative ? nativeBiometric.enableAppLock : webauthn.enableAppLock;
export const disableAppLock = isNative ? nativeBiometric.disableAppLock : webauthn.disableAppLock;
export const verifyAppLock = isNative ? nativeBiometric.verifyAppLock : webauthn.verifyAppLock;
export const clearAppLockLocal = isNative ? nativeBiometric.clearAppLockLocal : webauthn.clearAppLockLocal;

/** Always async — the native check (NativeBiometric.isAvailable) is
 * inherently async, unlike the web path's synchronous
 * browserSupportsWebAuthn(). Callers must await/useEffect this. */
export async function isAppLockSupported(): Promise<boolean> {
  return isNative ? nativeBiometric.isAppLockSupported() : webauthn.isAppLockSupported();
}
