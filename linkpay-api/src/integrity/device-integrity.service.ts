import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { GoogleServiceAuth } from './google-service-auth';
import { evaluateIntegrity, PlayIntegrityPayload, TOKEN_MAX_AGE_MS } from './integrity-policy';

export type IntegrityMode = 'off' | 'warn' | 'enforce';
export const CLIENT_PLATFORMS = ['android-app', 'ios-app', 'web', 'desktop'] as const;
export const ANDROID_APP = 'android-app';

const NONCE_BYTES = 16;
const MAC_BYTES = 16;
const DEFAULT_PACKAGE = 'com.scanlinkpay.app';
const DEFAULT_MAX_AGE_HOURS = 24;

/** Only a value from our own list is stored: the header is client-controlled text. */
export const cleanPlatform = (raw: unknown): string | null =>
  typeof raw === 'string' && (CLIENT_PLATFORMS as readonly string[]).includes(raw) ? raw : null;

/**
 * Device and app integrity (Google Play Integrity) for the Android app.
 *
 *   DEVICE_INTEGRITY_MODE=off      (default) verdicts are recorded if sent, nothing is ever blocked
 *   DEVICE_INTEGRITY_MODE=warn     + an admin alert when a device is untrusted; still nothing blocked
 *   DEVICE_INTEGRITY_MODE=enforce  money leaving a wallet from an Android-app session needs a TRUSTED verdict
 *                                  younger than INTEGRITY_MAX_AGE_HOURS (24); the app re-attests by itself
 *
 * Configuration: PLAY_INTEGRITY_CLIENT_EMAIL + PLAY_INTEGRITY_PRIVATE_KEY (a service account allowed to
 * decode tokens, in the Google Cloud project linked to the app in the Play Console), ANDROID_PACKAGE_NAME
 * (default com.scanlinkpay.app), ANDROID_CERT_SHA256 (comma-separated SHA-256 of OUR signing certificate(s),
 * recommended), INTEGRITY_REQUIRE_PLAY_RECOGNIZED (default true: set false for APKs distributed outside Play).
 *
 * What it does NOT do: stop someone calling the API directly with stolen credentials from a computer — that
 * is the job of the PIN, the transaction limits and the risk engine. It makes a compromised PHONE (rooted,
 * emulated, repackaged app) unable to move money, and tells the admins about it.
 */
@Injectable()
export class DeviceIntegrityService {
  private readonly logger = new Logger(DeviceIntegrityService.name);
  private auth: GoogleServiceAuth | null | undefined;

  constructor(
    private config: ConfigService,
    private supabaseService: SupabaseService,
    private alerts: SecurityAlertsService,
  ) {}

  get mode(): IntegrityMode {
    const m = (this.config.get<string>('DEVICE_INTEGRITY_MODE') || 'off').toLowerCase();
    return m === 'warn' || m === 'enforce' ? m : 'off';
  }

  private get packageName() {
    return this.config.get<string>('ANDROID_PACKAGE_NAME') || DEFAULT_PACKAGE;
  }

  private get maxAgeMs() {
    return (Number(this.config.get('INTEGRITY_MAX_AGE_HOURS')) || DEFAULT_MAX_AGE_HOURS) * 3_600_000;
  }

  private googleAuth(): GoogleServiceAuth | null {
    if (this.auth === undefined) {
      const email = this.config.get<string>('PLAY_INTEGRITY_CLIENT_EMAIL');
      const key = this.config.get<string>('PLAY_INTEGRITY_PRIVATE_KEY');
      this.auth = email && key ? new GoogleServiceAuth(email, key, 'https://www.googleapis.com/auth/playintegrity') : null;
    }
    return this.auth;
  }

  get configured(): boolean {
    return this.googleAuth() !== null;
  }

  // ------------------------------------------------------------------ challenge (nonce)

  private macKey() {
    // Derived from the JWT secret, with a label: the same secret never signs two different things.
    return createHmac('sha256', this.config.get<string>('JWT_SECRET') || '').update('device-integrity-nonce').digest();
  }

  private mac(userId: string, payload: Buffer) {
    return createHmac('sha256', this.macKey()).update(userId).update(payload).digest().subarray(0, MAC_BYTES);
  }

  /** A one-time challenge bound to this user and valid for a few minutes: the signed verdict must contain it. */
  issueNonce(userId: string, now = Date.now()): string {
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(BigInt(now));
    const payload = Buffer.concat([ts, randomBytes(NONCE_BYTES)]);
    return Buffer.concat([payload, this.mac(userId, payload)]).toString('base64url');
  }

  verifyNonce(userId: string, nonce: string, now = Date.now()): boolean {
    let raw: Buffer;
    try { raw = Buffer.from(nonce, 'base64url'); } catch { return false; }
    if (raw.length !== 8 + NONCE_BYTES + MAC_BYTES) return false;
    const payload = raw.subarray(0, 8 + NONCE_BYTES);
    const mac = raw.subarray(8 + NONCE_BYTES);
    if (!timingSafeEqual(mac, this.mac(userId, payload))) return false;
    const issued = Number(raw.readBigUInt64BE(0));
    return now - issued <= TOKEN_MAX_AGE_MS && issued - now < 60_000;
  }

  // ------------------------------------------------------------------ verification

  private async decode(token: string): Promise<PlayIntegrityPayload> {
    const auth = this.googleAuth();
    if (!auth) throw new ServiceUnavailableException("La vérification d'intégrité n'est pas configurée.");
    try {
      const res = await fetch(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.packageName)}:decodeIntegrityToken`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await auth.accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrity_token: token }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.error(`Play Integrity refused to decode a token (${res.status}): ${(await res.text()).slice(0, 200)}`);
        throw new Error(`status ${res.status}`);
      }
      return ((await res.json()) as { tokenPayloadExternal: PlayIntegrityPayload }).tokenPayloadExternal;
    } catch (err: any) {
      // Google down, quota, wrong credentials: nothing is concluded about the device.
      throw new ServiceUnavailableException("Impossible de vérifier l'appareil pour le moment.");
    }
  }

  async verify(userId: string, input: { token: string; signals?: string[]; rooted?: boolean; appVersion?: string }, now = Date.now()) {
    const payload = await this.decode(input.token);
    const nonce = payload?.requestDetails?.nonce || '';

    let status: 'trusted' | 'untrusted';
    let reasons: string[];
    if (!this.verifyNonce(userId, nonce, now)) {
      // Not a challenge we gave this user (or too old): a replayed or borrowed verdict.
      status = 'untrusted';
      reasons = ['nonce_invalid'];
    } else {
      const verdict = evaluateIntegrity(
        payload,
        {
          packageName: this.packageName,
          nonce,
          certDigests: (this.config.get<string>('ANDROID_CERT_SHA256') || '').split(',').map((s) => s.trim()).filter(Boolean),
          requireRecognized: this.config.get<string>('INTEGRITY_REQUIRE_PLAY_RECOGNIZED') !== 'false',
          now,
        },
        input.signals || [],
        !!input.rooted,
      );
      status = verdict.trusted ? 'trusted' : 'untrusted';
      reasons = verdict.reasons;
    }

    const { error } = await this.supabaseService.getClient().from('device_attestations').insert({
      user_id: userId,
      status,
      reasons,
      client_signals: (input.signals || []).slice(0, 20),
      app_version: input.appVersion?.slice(0, 40) ?? null,
      nonce_hash: createHash('sha256').update(nonce || input.token.slice(0, 64)).digest('hex'),
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new BadRequestException('Ce défi a déjà été utilisé.');
      this.logger.error(`Could not record a device attestation: ${error.message}`);
      throw new ServiceUnavailableException("Impossible d'enregistrer la vérification de l'appareil.");
    }

    if (status === 'untrusted' && this.mode !== 'off') {
      void this.alerts.alert({
        severity: 'warning',
        title: 'Appareil non sécurisé détecté',
        body: `Un compte utilise l'application sur un appareil non fiable (${reasons.join(', ')}). Compte ${userId}.`,
        dedupeKey: `device-untrusted:${userId}`,
        data: { user_id: userId, reasons },
      });
    }
    return { status, reasons, valid_for_hours: Math.round(this.maxAgeMs / 3_600_000) };
  }

  // ------------------------------------------------------------------ enforcement (money leaving a wallet)

  async latest(userId: string): Promise<{ status: string; created_at: string } | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('device_attestations')
      .select('status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async sessionPlatform(userId: string): Promise<string | null> {
    const { data, error } = await this.supabaseService.getClient().from('profiles').select('active_client_platform').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.active_client_platform ?? null;
  }

  /** Called before a transfer or a withdrawal. Does nothing unless DEVICE_INTEGRITY_MODE=enforce. */
  async assertMoneyOutAllowed(userId: string, headerPlatform?: unknown, now = Date.now()): Promise<void> {
    if (this.mode !== 'enforce') return;
    try {
      // The session's own platform (set at login) wins: a stolen Android-app token replayed from a computer is still an Android-app session.
      const platform = (await this.sessionPlatform(userId)) ?? cleanPlatform(headerPlatform);
      if (platform !== ANDROID_APP && cleanPlatform(headerPlatform) !== ANDROID_APP) return;

      const last = await this.latest(userId);
      const fresh = last && now - new Date(last.created_at).getTime() <= this.maxAgeMs;
      if (!last || !fresh) {
        throw new ForbiddenException({ statusCode: 403, code: 'DEVICE_INTEGRITY_REQUIRED', message: "Vérification de l'appareil requise. Réessayez dans un instant." });
      }
      if (last.status !== 'trusted') {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'DEVICE_UNTRUSTED',
          message: "Cet appareil n'est pas sécurisé (rooté, émulé ou application modifiée) : les retraits et transferts sont désactivés ici. Utilisez un appareil non modifié.",
        });
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Can't read the tables (migration 054 not applied, outage): never freeze every payment because of it.
      this.logger.error(`Device integrity check skipped: ${(err as Error).message}`);
    }
  }
}
