import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import api from './api';

const LOCK_ENABLED_KEY = 'linkpay_app_lock_enabled';
const LOCK_CREDENTIAL_ID_KEY = 'linkpay_app_lock_credential_id';

/**
 * App-lock — an OPTIONAL Settings toggle that requires the device's own
 * platform authenticator (fingerprint, face, PIN, pattern) to re-open the
 * app UI, even though the underlying JWT session stays valid the whole
 * time. This is deliberately separate from login: it's a per-device flag
 * (a WebAuthn "platform" credential is inherently tied to one device), not
 * part of the user's profile — a second device never inherits it.
 */
export function isAppLockSupported(): boolean {
  return browserSupportsWebAuthn();
}

export function isAppLockEnabled(): boolean {
  return localStorage.getItem(LOCK_ENABLED_KEY) === '1';
}

export function setAppLockEnabled(enabled: boolean) {
  localStorage.setItem(LOCK_ENABLED_KEY, enabled ? '1' : '0');
}

/** Clears all local app-lock state without touching the server-side
 * credential — used on logout, so a fresh login (possibly a different
 * account) on this device never inherits a stale "locked" state or a
 * credential id pointing at the previous user's row. */
export function clearAppLockLocal() {
  localStorage.removeItem(LOCK_ENABLED_KEY);
  localStorage.removeItem(LOCK_CREDENTIAL_ID_KEY);
}

/** Runs the WebAuthn registration ceremony and enrolls this device. Throws
 * if the user cancels the OS prompt or the ceremony otherwise fails. */
export async function enableAppLock(): Promise<void> {
  const { data: optionsJSON } = await api.post('/webauthn/register/options');
  const attResp = await startRegistration({ optionsJSON });
  const { data } = await api.post('/webauthn/register/verify', attResp);
  // Remember which server-side row is "this device's" credential, so
  // disabling later revokes exactly that one — not a guess among however
  // many other devices the account may have enrolled.
  localStorage.setItem(LOCK_CREDENTIAL_ID_KEY, data.id);
  setAppLockEnabled(true);
}

/** Revokes this device's server-side credential (if one was ever
 * registered) and clears the local flag. Safe to call even if the ceremony
 * was never completed. */
export async function disableAppLock(): Promise<void> {
  const credentialId = localStorage.getItem(LOCK_CREDENTIAL_ID_KEY);
  if (credentialId) {
    try {
      await api.delete(`/webauthn/credentials/${credentialId}`);
    } catch {
      // Best-effort — still clear the local flag so the device stops
      // showing the lock screen even if the server call failed (offline,
      // token expired, etc.).
    }
    localStorage.removeItem(LOCK_CREDENTIAL_ID_KEY);
  }
  setAppLockEnabled(false);
}

/** Runs the WebAuthn authentication ceremony. Returns true on success,
 * throws if the user cancels the OS prompt or verification fails. */
export async function verifyAppLock(): Promise<boolean> {
  const { data: optionsJSON } = await api.post('/webauthn/auth/options');
  const authResp = await startAuthentication({ optionsJSON });
  await api.post('/webauthn/auth/verify', authResp);
  return true;
}

export async function listAppLockCredentials(): Promise<Array<{ id: string; device_name: string | null; created_at: string; last_used_at: string | null }>> {
  const { data } = await api.get('/webauthn/credentials');
  return data;
}
