/** Decoded payload of a Play Integrity token (the `tokenPayloadExternal` of Google's decodeIntegrityToken). */
export interface PlayIntegrityPayload {
  requestDetails?: { requestPackageName?: string; nonce?: string; timestampMillis?: string | number };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[]; versionCode?: string | number };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

export interface IntegrityExpectations {
  packageName: string;
  nonce: string;
  /** SHA-256 digests of OUR signing certificate (hex, with or without colons). Empty = not checked. */
  certDigests: string[];
  /** Require the app to be the unmodified build Google Play recognises (turn off for APKs distributed outside Play). */
  requireRecognized: boolean;
  now: number;
}

export interface IntegrityVerdict {
  trusted: boolean;
  reasons: string[];
}

export const TOKEN_MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/** Google returns certificate digests base64url; people copy them from `keytool` as hex with colons. Compare as lowercase hex. */
export function normalizeDigest(d: string): string {
  const s = d.trim();
  if (/^[0-9a-fA-F:]+$/.test(s) && s.replace(/:/g, '').length === 64) return s.replace(/:/g, '').toLowerCase();
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Decides whether a verdict from Google means "this is our genuine app on a genuine, uncompromised
 * device". Every failed condition is listed, so an admin (and the user) can see why.
 *
 * `MEETS_DEVICE_INTEGRITY` is what a rooted phone, an emulator, an unlocked bootloader with a custom
 * ROM, or a device without Google certification lacks. `PLAY_RECOGNIZED` is what a repackaged or
 * tampered copy of the app lacks.
 */
export function evaluateIntegrity(payload: PlayIntegrityPayload | null | undefined, expected: IntegrityExpectations, clientSignals: string[] = [], clientReportsRoot = false): IntegrityVerdict {
  const reasons: string[] = [];
  const req = payload?.requestDetails;

  if (!payload || !req) return { trusted: false, reasons: ['unreadable_verdict'] };
  if (req.requestPackageName !== expected.packageName) reasons.push('wrong_package');
  if (req.nonce !== expected.nonce) reasons.push('nonce_mismatch');
  const ts = Number(req.timestampMillis);
  if (!Number.isFinite(ts) || expected.now - ts > TOKEN_MAX_AGE_MS || ts - expected.now > CLOCK_SKEW_MS) reasons.push('stale_token');

  const app = payload.appIntegrity;
  if (expected.requireRecognized && app?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push('app_not_recognized');
  if (expected.certDigests.length > 0) {
    const ours = new Set(expected.certDigests.map(normalizeDigest));
    const theirs = (app?.certificateSha256Digest || []).map(normalizeDigest);
    if (!theirs.some((d) => ours.has(d))) reasons.push('wrong_signing_cert');
  }

  if (!(payload.deviceIntegrity?.deviceRecognitionVerdict || []).includes('MEETS_DEVICE_INTEGRITY')) reasons.push('device_not_certified');

  // The app's own checks can only ADD suspicion (a rooted device can hide from them, never the reverse).
  if (clientReportsRoot) reasons.push('client_reports_root');

  return { trusted: reasons.length === 0, reasons };
}
