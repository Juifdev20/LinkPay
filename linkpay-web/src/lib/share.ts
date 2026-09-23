import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

export interface ShareData {
  title?: string;
  text?: string;
  url: string;
}

/**
 * The one deployed address a link needs to be useful to whoever receives
 * it — window.location.origin is only that on the real web/PWA build.
 * Inside the Android app it resolves to "https://localhost" (Capacitor's
 * internal WebView host), same regardless of whether that build talks to
 * Render or a local dev backend, so it's always wrong there.
 */
export function publicOrigin(): string {
  if (Capacitor.isNativePlatform()) {
    return import.meta.env.VITE_PUBLIC_WEB_URL || window.location.origin;
  }
  return window.location.origin;
}

/**
 * Uses the phone's real share sheet (SMS, WhatsApp, etc.). On native
 * (Android/iOS) this goes through @capacitor/share — a native bridge call,
 * not dependent on the WebView implementing navigator.share (it mostly
 * doesn't). Elsewhere (mobile/desktop browsers, installed PWAs) it uses
 * navigator.share where available and falls back to clipboard copy.
 * Returns which path was taken so callers can show the right feedback
 * ("Partagé" vs "Copié") — a user cancelling the native share sheet is not
 * an error and resolves 'share' too, matching how the share sheet itself
 * behaves.
 */
export async function shareOrCopy(data: ShareData): Promise<'share' | 'copy'> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share(data);
      return 'share';
    } catch {
      // User cancelled, or no share target — fall through to clipboard.
    }
    await navigator.clipboard.writeText(data.url);
    return 'copy';
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator
    && (!('canShare' in navigator) || navigator.canShare(data));

  if (canShare) {
    try {
      await navigator.share(data);
      return 'share';
    } catch {
      // AbortError (user cancelled) or any other failure — fall through to
      // clipboard so the action still does *something* useful.
    }
  }

  await navigator.clipboard.writeText(data.url);
  return 'copy';
}
