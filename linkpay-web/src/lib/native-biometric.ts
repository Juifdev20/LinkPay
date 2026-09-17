import { NativeBiometric, BiometricAuthError } from 'capacitor-native-biometric';

const LOCK_ENABLED_KEY = 'linkpay_app_lock_enabled';

// Error codes that mean "the user backed out of the OS prompt" rather than
// "biometrics are broken/unavailable" — normalized below to a
// NotAllowedError so callers (AppLockGate, Settings) can keep the same
// `err.name === 'NotAllowedError'` check they already use for the WebAuthn
// path, without knowing which implementation is active.
const CANCEL_CODES = new Set<number>([
  BiometricAuthError.USER_CANCEL,
  BiometricAuthError.APP_CANCEL,
  BiometricAuthError.SYSTEM_CANCEL,
]);

function normalizeError(err: any): Error {
  const code = Number(err?.code);
  if (CANCEL_CODES.has(code)) {
    return new DOMException('Annulé.', 'NotAllowedError');
  }
  return err instanceof Error ? err : new Error(err?.message || 'Échec — réessayez.');
}

/**
 * Native (Android/Capacitor) counterpart of src/lib/webauthn.ts's app-lock
 * API. A JWT session already exists by the time this runs, so unlike
 * WebAuthn there's no server-side credential to enroll or revoke — this is
 * purely a local "is this the same device, unlocked by its own biometrics"
 * gate. See src/lib/app-lock.ts for the platform switch.
 */
export function isAppLockEnabled(): boolean {
  return localStorage.getItem(LOCK_ENABLED_KEY) === '1';
}

export function setAppLockEnabled(enabled: boolean) {
  localStorage.setItem(LOCK_ENABLED_KEY, enabled ? '1' : '0');
}

export async function isAppLockSupported(): Promise<boolean> {
  try {
    const { isAvailable } = await NativeBiometric.isAvailable({ useFallback: false });
    return isAvailable;
  } catch {
    return false;
  }
}

/** Confirms the device can authenticate the user right now, then flips the
 * local flag on. No server round-trip — nothing to enroll. */
export async function enableAppLock(): Promise<void> {
  try {
    await NativeBiometric.verifyIdentity({
      title: 'Activer le verrouillage',
      subtitle: 'Confirmez votre identité pour activer le verrouillage de LinkPay',
    });
  } catch (err) {
    throw normalizeError(err);
  }
  setAppLockEnabled(true);
}

/** No server-side credential exists on the native path — disabling is just
 * clearing the local flag. */
export async function disableAppLock(): Promise<void> {
  setAppLockEnabled(false);
}

export async function verifyAppLock(): Promise<boolean> {
  try {
    await NativeBiometric.verifyIdentity({
      title: 'Déverrouiller LinkPay',
      subtitle: 'Utilisez votre empreinte ou votre visage',
    });
    return true;
  } catch (err) {
    throw normalizeError(err);
  }
}

/** Mirrors webauthn.ts's clearAppLockLocal() — used on logout. */
export function clearAppLockLocal() {
  localStorage.removeItem(LOCK_ENABLED_KEY);
}
