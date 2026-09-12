import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, generateUserID } from '@simplewebauthn/server/helpers';
import type { RegistrationResponseJSON, AuthenticationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import { SupabaseService } from '../supabase/supabase.service';

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

/**
 * Optional "app lock" feature: after a user already holds a valid JWT
 * session, this lets Settings require the device's own platform
 * authenticator (Windows Hello, Android fingerprint/face, iOS Touch/Face
 * ID — never a roaming USB security key, enforced via
 * `authenticatorAttachment: 'platform'`) to re-open the app UI. It is not a
 * login mechanism and never replaces the JWT flow in auth.service.ts.
 */
@Injectable()
export class WebauthnService {
  private readonly logger = new Logger(WebauthnService.name);
  private readonly rpName = 'LinkPay';

  // Registration/authentication challenges are short-lived (~2 min) and
  // single-use — an in-memory map is sufficient as long as this API runs as
  // a single instance (render.yaml: plan `starter`, single instance today).
  // If this ever moves to multiple instances behind a load balancer without
  // sticky sessions, move this to a table instead — a request could
  // otherwise generate its challenge on one instance and verify it on
  // another, a `PendingChallenge` never present there.
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly CHALLENGE_TTL_MS = 2 * 60 * 1000;

  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {}

  private get rpID(): string {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    return new URL(frontendUrl).hostname;
  }

  // Mirrors the CORS allow-list in main.ts — WebAuthn's expectedOrigin check
  // is exactly the same "which origins may legitimately act as this app"
  // question CORS already answers, so local dev on any of these ports and
  // the real deployed frontend both verify correctly.
  private get expectedOrigins(): string[] {
    const origins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:5177',
      'http://localhost:5178',
      'http://localhost:5179',
      'http://localhost:5180',
    ];
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (frontendUrl && !origins.includes(frontendUrl)) origins.push(frontendUrl);
    return origins;
  }

  private setChallenge(userId: string, challenge: string) {
    this.challenges.set(userId, { challenge, expiresAt: Date.now() + this.CHALLENGE_TTL_MS });
  }

  private takeChallenge(userId: string): string {
    const pending = this.challenges.get(userId);
    this.challenges.delete(userId);
    if (!pending || Date.now() > pending.expiresAt) {
      throw new BadRequestException('Challenge expired or missing — please try again');
    }
    return pending.challenge;
  }

  private async getUserCredentials(userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('webauthn_credentials')
      .select('*')
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to fetch WebAuthn credentials: ${error.message}`);
    return data || [];
  }

  async generateRegistrationOptionsFor(userId: string, email: string) {
    const existing = await this.getUserCredentials(userId);

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: email,
      // A fresh random handle per ceremony — NOT derived from our own userId
      // — is deliberate, not an oversight: some platform authenticators
      // (notably Android/Chrome's passkey store) key their own credential
      // storage by (rpID, user.id) and silently refuse — or throw
      // InvalidStateError — to create a second credential for a (rpID,
      // user.id) pair they've already seen, even after we've deleted our
      // own DB row for it (disable → re-enable on the same device/account).
      // WebAuthn auth here never needs this handle again afterward — we
      // always pass `allowCredentials` built from our own DB by
      // `credential_id`, never relying on a stable user.id to discover
      // credentials — so randomizing it is free and sidesteps the whole
      // class of "can't re-register after disabling" failures.
      userID: await generateUserID(),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
    });

    this.setChallenge(userId, options.challenge);
    return options;
  }

  async verifyRegistration(userId: string, response: RegistrationResponseJSON, deviceName?: string) {
    const expectedChallenge = this.takeChallenge(userId);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Registration verification failed');
    }

    const { credential } = verification.registrationInfo;

    const { data: row, error } = await this.supabaseService.getClient()
      .from('webauthn_credentials')
      .insert({
        user_id: userId,
        credential_id: credential.id,
        public_key: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || null,
        device_name: deviceName || null,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to save WebAuthn credential: ${error.message}`);

    this.logger.log(`WebAuthn credential registered for user ${userId}`);
    return { success: true, id: row.id };
  }

  async generateAuthenticationOptionsFor(userId: string) {
    const existing = await this.getUserCredentials(userId);
    if (!existing.length) {
      throw new NotFoundException('No app-lock credential registered for this device');
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      allowCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
    });

    this.setChallenge(userId, options.challenge);
    return options;
  }

  async verifyAuthentication(userId: string, response: AuthenticationResponseJSON) {
    const expectedChallenge = this.takeChallenge(userId);

    const { data: row, error } = await this.supabaseService.getClient()
      .from('webauthn_credentials')
      .select('*')
      .eq('credential_id', response.id)
      .single();

    if (error || !row) {
      throw new NotFoundException('Unknown credential');
    }
    if (row.user_id !== userId) {
      throw new ForbiddenException('This credential does not belong to the current session');
    }

    const credential: WebAuthnCredential = {
      id: row.credential_id,
      publicKey: isoBase64URL.toBuffer(row.public_key),
      counter: row.counter,
      transports: row.transports || undefined,
    };

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
      credential,
    });

    if (!verification.verified) {
      throw new BadRequestException('Authentication verification failed');
    }

    await this.supabaseService.getClient()
      .from('webauthn_credentials')
      .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
      .eq('id', row.id);

    return { success: true };
  }

  async listCredentials(userId: string) {
    const rows = await this.getUserCredentials(userId);
    return rows.map((r) => ({
      id: r.id,
      device_name: r.device_name,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    }));
  }

  async deleteCredential(userId: string, id: string) {
    await this.supabaseService.getClient()
      .from('webauthn_credentials')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    return { success: true };
  }
}
