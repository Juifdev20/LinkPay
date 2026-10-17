import { registerPlugin } from '@capacitor/core';
import api from './api';
import { isAndroidApp, useDeviceUntrusted } from './client-platform';

/**
 * Device and app integrity — Android app only (see DeviceIntegrityPlugin.java).
 *
 * The app asks Google Play Integrity to vouch for the app (genuine, unmodified, signed by us) and
 * the device (certified, not rooted/emulated), plus runs its own root heuristics, and sends both to
 * the API, which verifies the Google verdict itself and decides. This file only collects and
 * forwards: nothing here is trusted by the server on its own.
 *
 * Needs VITE_PLAY_CLOUD_PROJECT_NUMBER (the Google Cloud project linked to the app in the Play
 * Console). Without it the app does nothing here — which is also what the API expects while
 * DEVICE_INTEGRITY_MODE=off.
 */
interface DeviceIntegrityPlugin {
  checkRoot(): Promise<{ rooted: boolean; signals: string[] }>;
  requestIntegrityToken(options: { nonce: string; cloudProjectNumber: string }): Promise<{ token: string }>;
}

const DeviceIntegrity = registerPlugin<DeviceIntegrityPlugin>('DeviceIntegrity');

const RECHECK_MS = 6 * 3_600_000;
let lastRun = 0;
let inflight: Promise<boolean> | null = null;

/**
 * Runs the check (at most once every 6 hours unless forced). Resolves true when the device was
 * verified as trusted. Never throws: a failed check just means "not verified", and the API alone
 * decides what that allows.
 */
export function runDeviceCheck(force = false): Promise<boolean> {
  if (!isAndroidApp()) return Promise.resolve(false);
  const project = import.meta.env.VITE_PLAY_CLOUD_PROJECT_NUMBER as string | undefined;
  if (!project) return Promise.resolve(false);
  if (!force && Date.now() - lastRun < RECHECK_MS) return Promise.resolve(true);
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const root = await DeviceIntegrity.checkRoot().catch(() => ({ rooted: false, signals: [] as string[] }));
      const { data: challenge } = await api.post('/integrity/nonce');
      const { token } = await DeviceIntegrity.requestIntegrityToken({ nonce: challenge.nonce, cloudProjectNumber: project });
      const { data } = await api.post('/integrity/verify', { token, signals: root.signals, rooted: root.rooted });
      lastRun = Date.now();
      if (data.status !== 'trusted') useDeviceUntrusted.getState().show();
      return data.status === 'trusted';
    } catch {
      return false; // Play services missing, offline, Google unreachable…
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
