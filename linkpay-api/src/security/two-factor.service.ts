import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { SupabaseService } from '../supabase/supabase.service';
import { getRequiredJwtSecret } from '../auth/jwt-secret.util';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { generateSecret, otpauthUrl, verifyCode } from './totp';

const RECOVERY_CODE_COUNT = 8;

export const hashRecoveryCode = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');

/**
 * Authenticator-app (TOTP) second factor, required for administrators.
 *
 * - The shared secret is stored AES-256-GCM encrypted, so a leaked database
 *   copy alone doesn't hand over everyone's codes.
 * - A code is accepted once (the time step is claimed atomically in the
 *   database), so watching someone type a code over their shoulder or in a
 *   proxy log is useless 30 seconds later.
 * - Wrong codes count towards the same kind of lockout as passwords.
 * - Recovery codes (shown once, stored hashed) are the way back in after a
 *   lost phone; each works once.
 */
@Injectable()
export class TwoFactorService {
  private readonly key: Buffer;

  constructor(
    private supabaseService: SupabaseService,
    private attempts: LoginAttemptsService,
    config: ConfigService,
  ) {
    const material = config.get<string>('TWO_FACTOR_ENCRYPTION_KEY') || getRequiredJwtSecret(config);
    this.key = createHash('sha256').update(`2fa:${material}`).digest();
  }

  encryptSecret(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  decryptSecret(stored: string): string {
    const [version, iv, tag, ct] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unreadable 2FA secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  }

  private async load(userId: string) {
    const { data } = await this.supabaseService.getClient()
      .from('profiles')
      .select('email, two_factor_enabled, two_factor_secret')
      .eq('id', userId)
      .single();
    return data as { email: string; two_factor_enabled: boolean; two_factor_secret: string | null } | null;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const p = await this.load(userId);
    return !!p?.two_factor_enabled && !!p.two_factor_secret;
  }

  /** Starts enrolment: a fresh secret, not active until confirmSetup() proves the app works. */
  async beginSetup(userId: string, accountLabel: string) {
    const profile = await this.load(userId);
    if (profile?.two_factor_enabled) throw new ConflictException('La double authentification est déjà activée');
    const secret = generateSecret();
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ two_factor_secret: this.encryptSecret(secret), two_factor_enabled: false })
      .eq('id', userId);
    if (error) throw new Error(`Failed to store 2FA secret: ${error.message}`);
    const url = otpauthUrl(secret, accountLabel);
    return { secret, otpauth_url: url, qr_data_url: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
  }

  /** Confirms the first code, switches 2FA on and returns the recovery codes (shown only now). */
  async confirmSetup(userId: string, code: string): Promise<string[]> {
    this.assertNotLocked(userId);
    const profile = await this.load(userId);
    if (!profile?.two_factor_secret || profile.two_factor_enabled) {
      throw new BadRequestException("Lancez d'abord la configuration de la double authentification");
    }
    const step = verifyCode(this.decryptSecret(profile.two_factor_secret), code);
    if (step === null || !(await this.claimStep(userId, step))) {
      this.fail(userId);
      throw new BadRequestException('Code incorrect. Vérifiez l\'heure de votre téléphone et réessayez.');
    }
    const plainCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex').toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({
        two_factor_enabled: true,
        two_factor_enrolled_at: new Date().toISOString(),
        two_factor_recovery_hashes: plainCodes.map(hashRecoveryCode),
      })
      .eq('id', userId);
    if (error) throw new Error(`Failed to enable 2FA: ${error.message}`);
    this.attempts.recordSuccess(this.attemptKey(userId));
    return plainCodes;
  }

  /** Checks an authenticator code, or a recovery code. Never reveals which part was wrong. */
  async verify(userId: string, code: string): Promise<boolean> {
    this.assertNotLocked(userId);
    const profile = await this.load(userId);
    if (!profile?.two_factor_enabled || !profile.two_factor_secret) return false;

    const trimmed = (code || '').trim();
    let ok = false;
    if (/^\d{6}$/.test(trimmed)) {
      const step = verifyCode(this.decryptSecret(profile.two_factor_secret), trimmed);
      ok = step !== null && (await this.claimStep(userId, step));
    } else if (/^[0-9A-Fa-f]{5}-?[0-9A-Fa-f]{5}$/.test(trimmed)) {
      const { data } = await this.supabaseService.getClient()
        .rpc('consume_recovery_code', { p_user_id: userId, p_hash: hashRecoveryCode(trimmed) });
      ok = data === true;
    }

    if (ok) this.attempts.recordSuccess(this.attemptKey(userId));
    else this.fail(userId);
    return ok;
  }

  async assertValid(userId: string, code: string | undefined): Promise<void> {
    if (!code || !(await this.verify(userId, code))) {
      throw new ForbiddenException({ statusCode: 403, code: 'OTP_STEP_UP_INVALID', message: 'Code de double authentification incorrect' });
    }
  }

  /** Super-admin recovery path for a colleague who lost both phone and recovery codes. */
  async reset(userId: string): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ two_factor_enabled: false, two_factor_secret: null, two_factor_last_step: null, two_factor_recovery_hashes: [], two_factor_enrolled_at: null })
      .eq('id', userId);
    if (error) throw new Error(`Failed to reset 2FA: ${error.message}`);
  }

  private async claimStep(userId: string, step: number): Promise<boolean> {
    const { data } = await this.supabaseService.getClient().rpc('claim_totp_step', { p_user_id: userId, p_step: step });
    return data === true;
  }

  private attemptKey(userId: string) {
    return `otp:${userId}`;
  }

  private assertNotLocked(userId: string) {
    this.attempts.assertNotLocked(this.attemptKey(userId));
  }

  private fail(userId: string) {
    this.attempts.recordFailure(this.attemptKey(userId));
  }
}
