/**
 * Everything the app says or beeps. Two layers:
 *  - a short BEEP (WebAudio, no file) on every successful scan, a low one when a scan fails;
 *  - the VOICE: pre-recorded clips of one female voice (Delphine, French; "Please try again" in English) shipped in
 *    /public/sounds/voice — same voice on every phone, works offline. Only the product name in a stock alert is read by the
 *    device's own text-to-speech, since it can't be pre-recorded.
 * Both follow the phone's MEDIA volume (HTMLAudio / WebAudio) and each can be turned off by the user (Settings → Sons et voix).
 * Nothing here may ever throw into its caller: sound is a help, never a reason for a payment or a scan to fail.
 */

const PREFS_KEY = 'slp:sound-prefs';

export type SoundPrefs = { beep: boolean; voice: boolean };

export function getSoundPrefs(): SoundPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { beep: raw.beep !== false, voice: raw.voice !== false };
  } catch {
    return { beep: true, voice: true };
  }
}

export function setSoundPrefs(prefs: Partial<SoundPrefs>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...getSoundPrefs(), ...prefs }));
  } catch { /* storage unavailable: the defaults apply */ }
}

export type VoiceClip =
  | 'please-try-again'
  | 'paiement-reussi'
  | 'paiement-recu'
  | 'paiement-echoue'
  | 'solde-insuffisant'
  | 'stock-bas-debut'
  | 'stock-epuise-debut'
  | 'approvisionner'
  | 'stock-bas'
  | 'stock-epuise';

type Part = VoiceClip | { text: string };

// ------------------------------------------------------------------
// Beeps
// ------------------------------------------------------------------
let audio: AudioContext | null = null;

function tone(freq: number, ms: number, gainValue = 0.3) {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    osc.type = 'square';
    gain.gain.value = gainValue;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio — silent */ }
}

/** Short high beep (a successful scan), with a light vibration. */
export function beepOk() {
  if (getSoundPrefs().beep) tone(1800, 110);
  try { navigator.vibrate?.(40); } catch { /* ignore */ }
}

// ------------------------------------------------------------------
// Voice
// ------------------------------------------------------------------
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  chain = chain.then(task).catch(() => undefined);
}

function playClip(name: VoiceClip): Promise<void> {
  return new Promise((resolve) => {
    try {
      const el = new Audio(`${import.meta.env.BASE_URL}sounds/voice/${name}.mp3`);
      el.volume = 1;
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
    } catch {
      resolve();
    }
  });
}

function readAloud(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      u.rate = 1;
      const voices = window.speechSynthesis.getVoices();
      // A French female voice when the phone has one; otherwise whatever French voice it has.
      const fr = voices.filter((v) => v.lang.toLowerCase().startsWith('fr'));
      const woman = fr.find((v) => /female|femme|amelie|audrey|hortense|julie|marie|google fran/i.test(v.name));
      if (woman || fr[0]) u.voice = (woman || fr[0])!;
      const guard = setTimeout(resolve, 8000);
      u.onend = u.onerror = () => { clearTimeout(guard); resolve(); };
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

/** Says the parts one after the other (clips and free text), never over another announcement. */
export function say(...parts: Part[]) {
  if (!getSoundPrefs().voice) return;
  enqueue(async () => {
    for (const p of parts) {
      if (typeof p === 'string') await playClip(p);
      else await readAloud(p.text);
    }
  });
}

let lastFailAt = 0;

/**
 * A scan that didn't work (unknown code, refused item): low beep + "Please try again". The camera reads many frames a second,
 * so the voice is not repeated more often than every 2.5 s.
 */
export function beepError() {
  if (getSoundPrefs().beep) tone(300, 280);
  try { navigator.vibrate?.([80, 60, 80]); } catch { /* ignore */ }
  const now = Date.now();
  if (now - lastFailAt < 2500) return;
  lastFailAt = now;
  say('please-try-again');
}

/** "Stock bas : <product>, pensez à vous approvisionner" — the clip, the product name read by the phone, then the advice. */
export function announceStock(productName: string | undefined, out: boolean) {
  const name = productName?.trim();
  if (!name) return say(out ? 'stock-epuise' : 'stock-bas');
  say(out ? 'stock-epuise-debut' : 'stock-bas-debut', { text: name }, 'approvisionner');
}

export const announce = {
  paymentSuccess: () => say('paiement-reussi'),
  /** "Paiement reçu" then the amount read by the phone. */
  paymentReceived: (amountText?: string) => (amountText ? say('paiement-recu', { text: amountText }) : say('paiement-recu')),
  paymentFailed: () => say('paiement-echoue'),
  insufficientBalance: () => say('solde-insuffisant'),
};

/**
 * What to say for a failed payment, from the message the server (or the mobile-money operator) gave:
 * "Solde insuffisant" when the balance is the cause, otherwise "Paiement échoué".
 */
export function announcePaymentError(message: string | undefined) {
  if (/solde|insuffisant|insufficient|fonds|balance/i.test(message || '')) announce.insufficientBalance();
  else announce.paymentFailed();
}
