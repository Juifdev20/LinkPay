export interface ShareData {
  title?: string;
  text?: string;
  url: string;
}

/**
 * Uses the phone's real share sheet (SMS, WhatsApp, etc.) when available —
 * mobile browsers and installed PWAs. Falls back to clipboard copy
 * everywhere else (desktop browsers mostly lack navigator.share). Returns
 * which path was taken so callers can show the right feedback ("Partagé"
 * vs "Copié") — a user cancelling the native share sheet is not an error
 * and resolves 'share' too, matching how the share sheet itself behaves.
 */
export async function shareOrCopy(data: ShareData): Promise<'share' | 'copy'> {
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
