import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { getRequiredJwtSecret } from '../auth/jwt-secret.util';
import { weakAppCodeReason } from './code-strength';
import { CONFIRM_TTL_S, signConfirmToken } from './confirm-token';

const BCRYPT_COST = 12;
const MAX_ATTEMPTS = 5;

export class SessionTerminatedException extends HttpException {
  constructor() {
    super(
      { statusCode: 401, code: 'SESSION_TERMINATED', message: 'Trop de codes incorrects. Pour votre sécurité, reconnectez-vous avec votre mot de passe.' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * The access code asked by the app at every launch / return / idle period.
 *
 * - The code is first run through HMAC-SHA256 with a server-side secret
 *   ("pepper") and only then bcrypt'd (cost 12): a leaked copy of the database
 *   cannot be brute-forced offline — 1,000,000 possible 6-digit codes would
 *   otherwise fall in minutes.
 * - Guesses are counted by the database BEFORE the comparison, so a burst of
 *   parallel requests cannot exceed the limit (see migration 050).
 * - After two lock-outs in a row the session is ended and the user has to log
 *   in with their password again; they are told by notification.
 */
@Injectable()
export class AppCodeService {
  private readonly logger = new Logger(AppCodeService.name);
  private readonly pepper: string;
  private readonly jwtSecret: string;

  constructor(
    private supabaseService: SupabaseService,
    private notifications: NotificationsService,
    private loginAttempts: LoginAttemptsService,
    config: ConfigService,
  ) {
    this.jwtSecret = getRequiredJwtSecret(config);
    this.pepper = createHash('sha256').update(`app-code:${config.get<string>('APP_CODE_PEPPER') || getRequiredJwtSecret(config)}`).digest('hex');
  }

  private peppered(code: string) {
    return createHmac('sha256', this.pepper).update(code).digest('base64');
  }

  private hash(code: string) {
    return bcrypt.hash(this.peppered(code), BCRYPT_COST);
  }

  private async profile(userId: string) {
    const { data } = await this.supabaseService.getClient()
      .from('profiles')
      .select('email, app_code_hash, transaction_pin_hash')
      .eq('id', userId)
      .single();
    return data as { email: string; app_code_hash: string | null; transaction_pin_hash: string | null } | null;
  }

  async hasCode(userId: string): Promise<boolean> {
    return !!(await this.profile(userId))?.app_code_hash;
  }

  private async assertAcceptable(code: string, confirm: string, transactionPinHash: string | null) {
    if (code !== confirm) throw new BadRequestException('Les deux codes ne sont pas identiques.');
    const weak = weakAppCodeReason(code);
    if (weak) throw new BadRequestException(weak);
    // (No "must differ from the transaction PIN" rule: answering differently when a candidate equals the PIN would let
    // anyone holding a session guess the PIN here, without the PIN's own lockout.)
  }

  /** First-time creation. Changing an existing code goes through change(). */
  async create(userId: string, code: string, confirm: string): Promise<void> {
    const p = await this.profile(userId);
    if (!p) throw new UnauthorizedException();
    if (p.app_code_hash) throw new ConflictException('Un code d’accès existe déjà. Utilisez « Modifier le code ».');
    await this.assertAcceptable(code, confirm, p.transaction_pin_hash);
    await this.store(userId, code);
  }

  /** Old code required; the new one is typed twice. */
  async change(userId: string, current: string, code: string, confirm: string): Promise<void> {
    const p = await this.profile(userId);
    if (!p?.app_code_hash) throw new BadRequestException("Aucun code d'accès n'est défini.");
    await this.verify(userId, current);
    if (current === code) throw new BadRequestException("Le nouveau code doit être différent de l'ancien.");
    await this.assertAcceptable(code, confirm, p.transaction_pin_hash);
    await this.store(userId, code);
    await this.notifications.create({
      user_id: userId,
      type: 'security',
      title: "Code d'accès modifié",
      body: "Le code d'accès de votre application vient d'être modifié. Si ce n'est pas vous, contactez le support immédiatement.",
    });
  }

  private async store(userId: string, code: string) {
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ app_code_hash: await this.hash(code), app_code_set_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw new Error(`Failed to store the access code: ${error.message}`);
    await this.supabaseService.getClient().rpc('clear_app_code_failures', { p_user_id: userId });
  }

  /** Throws unless the code is right. Counts the guess before comparing. */
  async verify(userId: string, code: string): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data: begin, error: beginError } = await client.rpc('begin_app_code_attempt', { p_user_id: userId });
    if (beginError) throw new Error(`Access code check unavailable: ${beginError.message}`);
    const start = Array.isArray(begin) ? begin[0] : begin;
    if (start?.status === 'terminate') await this.terminate(userId);
    if (start?.status === 'locked') this.throwLocked(start.locked_until);
    if (start?.status !== 'ok') throw new UnauthorizedException();

    const p = await this.profile(userId);
    const valid = !!p?.app_code_hash && /^\d{6}$/.test(code) && (await bcrypt.compare(this.peppered(code), p.app_code_hash));
    if (valid) {
      await client.rpc('clear_app_code_failures', { p_user_id: userId });
      return;
    }

    const { data: failed } = await client.rpc('fail_app_code_attempt', { p_user_id: userId });
    const f = Array.isArray(failed) ? failed[0] : failed;
    if (f?.status === 'terminate') await this.terminate(userId);
    if (f?.status === 'locked') this.throwLocked(f.locked_until);
    const left = Math.max(0, MAX_ATTEMPTS - (f?.attempts ?? start.attempts));
    throw new BadRequestException({ statusCode: 400, code: 'APP_CODE_INVALID', message: `Code incorrect. Il vous reste ${left} essai${left > 1 ? 's' : ''}.`, attempts_left: left });
  }

  /** The person re-types their code to authorise a sensitive action (stock, till…): returns a token valid for a few minutes. */
  async confirm(userId: string, code: string): Promise<{ confirmation_token: string; expires_in: number }> {
    if (!(await this.hasCode(userId))) {
      throw new BadRequestException("Créez d'abord votre code d'accès.");
    }
    await this.verify(userId, code);
    return { confirmation_token: signConfirmToken(this.jwtSecret, userId), expires_in: CONFIRM_TTL_S };
  }

  /** Forgot the code: the account password proves identity, and the code is wiped so a new one can be chosen. */
  async resetWithPassword(userId: string, password: string): Promise<void> {
    const p = await this.profile(userId);
    if (!p) throw new UnauthorizedException();
    const key = `appcode-reset:${userId}`;
    await this.loginAttempts.reserve(key);
    const { error } = await this.supabaseService.getAuthClient().auth.signInWithPassword({ email: p.email, password });
    if (error) {
      throw new ForbiddenException('Mot de passe incorrect.');
    }
    await this.loginAttempts.recordSuccess(key);
    const { error: updateError } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ app_code_hash: null, app_code_set_at: null })
      .eq('id', userId);
    if (updateError) throw new Error(`Failed to reset the access code: ${updateError.message}`);
    await this.supabaseService.getClient().rpc('clear_app_code_failures', { p_user_id: userId });
  }

  private throwLocked(until: string): never {
    const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000));
    throw new HttpException(
      { statusCode: 429, code: 'APP_CODE_LOCKED', message: `Trop d'essais. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`, retry_after_minutes: minutes },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** End the session: its tokens stop working (single-session roles) and the app logs out. */
  private async terminate(userId: string): Promise<never> {
    await this.supabaseService.getClient().from('profiles').update({ active_session_id: null }).eq('id', userId);
    await this.notifications.create({
      user_id: userId,
      type: 'security',
      title: 'Tentatives de déverrouillage échouées',
      body: "Plusieurs codes d'accès incorrects ont été saisis sur votre compte. Votre session a été fermée. Si ce n'était pas vous, changez votre mot de passe.",
    });
    this.logger.warn(`Access code: session terminated for ${userId} after repeated failures`);
    throw new SessionTerminatedException();
  }
}
