import { formatCurrency } from './utils';
import { announce, getSoundPrefs } from './sound';

/**
 * Synthesized "cha-ching" — a short ascending arpeggio via raw oscillators,
 * not an audio file. No asset to bundle/fail to load, works offline, and
 * sounds the same in the web PWA and the Capacitor Android WebView (both
 * implement Web Audio). Silently no-ops wherever AudioContext isn't
 * available — this is a delight-on-top feature, never allowed to throw
 * into a caller that just wants to react to a payment notification.
 */
export function playChime() {
  try {
    if (!getSoundPrefs().beep) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // A major-ish ascending triad — bright and "cash register" without
    // needing a real recording.
    const notes = [880, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
    // Contexts aren't garbage-collected on their own — release it once the
    // last note has finished ringing out.
    setTimeout(() => ctx.close().catch(() => null), (notes.length - 1) * 90 + 500);
  } catch {
    // Best-effort only.
  }
}

/** "Paiement reçu" in the recorded female voice, then the amount read by the phone — best-effort, never an error for the caller. */
export function announceAmount(amountCents: number, currency: string) {
  try {
    const amount = formatCurrency(amountCents, currency).replace(/\u00a0/g, ' ');
    announce.paymentReceived(amount);
  } catch {
    // Best-effort only.
  }
}
