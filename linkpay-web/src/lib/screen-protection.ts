import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import api from './api';

/**
 * Screenshot protection (super admin switch, platform_settings).
 * - Android app: FLAG_SECURE on the window.
 * - Windows app (linkpay-desktop): BrowserWindow content protection.
 * Screenshots and screen recordings of the app come out black. Browsers
 * expose no such control, so on the plain web this is a no-op.
 */
interface ScreenProtectionPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
  addListener(event: 'resume', cb: () => void): Promise<PluginListenerHandle>;
}

const ScreenProtection = registerPlugin<ScreenProtectionPlugin>('ScreenProtection');

/** While the app is open, how often the switch is re-read — a change by the
 *  super admin reaches a phone left open on the till within this delay. */
const POLL_MS = 30_000;

const onWindowsApp = () => typeof window !== 'undefined' && !!window.linkpayDesktop;
const isProtectable = () => Capacitor.isNativePlatform() || onWindowsApp();

/** Applies the switch on this device right away (super admin screen). */
export async function applyScreenProtection(enabled: boolean) {
  try {
    if (Capacitor.isNativePlatform()) await ScreenProtection.setEnabled({ enabled });
    else if (onWindowsApp()) await window.linkpayDesktop!.setContentProtection(enabled);
  } catch { /* older app build without the bridge — nothing to do */ }
}

async function refresh() {
  try {
    const { data } = await api.get('/platform/settings');
    await applyScreenProtection(!!data?.screenshot_protection);
  } catch {
    // Offline / server down: keep the last decision — the native side
    // already re-applied it at launch (MainActivity).
  }
}

/**
 * Reads the switch at launch, whenever the app returns to the foreground
 * (native resume signal + visibilitychange) and every 30 s while it stays
 * open — so a change by the super admin reaches every phone without an app
 * update, even one that never leaves the till screen. Returns a cleanup.
 */
export function startScreenProtection() {
  if (!isProtectable()) return () => {};
  refresh();

  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisible);

  let resumeHandle: PluginListenerHandle | null = null;
  if (Capacitor.isNativePlatform()) {
    ScreenProtection.addListener('resume', refresh)
      .then((h) => { resumeHandle = h; })
      .catch(() => { /* older build without the resume signal */ });
  }

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    resumeHandle?.remove();
    clearInterval(timer);
  };
}
