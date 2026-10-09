import { Injectable, Logger, UnauthorizedException, ConflictException, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { isAuthApiError } from '@supabase/supabase-js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDto, LoginDto } from './dto';
import { SESSION_TRACKING_EXEMPT_ROLES, MFA_REQUIRED_ROLES } from './constants';
import { getRequiredJwtSecret } from './jwt-secret.util';
import { LoginAttemptsService } from './login-attempts.service';
import { TwoFactorService } from '../security/two-factor.service';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { isAdminIpAllowed } from '../security/admin-ip';
import { cleanPlatform } from '../integrity/device-integrity.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  merchant_id?: string;
  // Set for enterprise-internal staff (magasinier/vendeur/caissier/
  // comptable — see organization-staff module), whose user_roles row is
  // organization_id-scoped rather than merchant_id-scoped. Lets stock/
  // caisse/ventes endpoints confirm a staff member belongs to the same
  // organization as the store they're trying to act on, without an extra
  // DB round trip per request.
  organization_id?: string;
  session_id?: string;
  // Set only on a token minted by OrganizationsService.enterMerchant(): the
  // holder's canonical role (in user_roles) is 'enterprise', owner of this
  // org, and role/merchant_id above are a temporary "acting as that store's
  // merchant" lens — not a permanent role change. See refresh() below.
  acting_as_org_id?: string;
  // Set only when an authenticator-app code was checked for this session
  // (mfa_at = when, in epoch seconds): required of admin roles, see JwtAuthGuard.
  mfa?: boolean;
  mfa_at?: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private supabaseService: SupabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private loginAttempts: LoginAttemptsService,
    private twoFactor: TwoFactorService,
    private securityAlerts: SecurityAlertsService,
  ) {}

  async register(dto: RegisterDto, ctx: { platform?: string } = {}) {
    const { email, password, phone, full_name, account_type, business_name } = dto;
    const roleSlug = account_type === 'merchant' ? 'merchant' : account_type === 'enterprise' ? 'enterprise' : 'client';

    const { data, error } = await this.supabaseService.getClient().auth.admin.createUser({
      email,
      password,
      phone,
      user_metadata: { full_name, phone },
      email_confirm: true,
    });

    if (error) {
      if (error.message.includes('already')) {
        throw new ConflictException('Email already registered');
      }
      throw new UnauthorizedException(error.message);
    }

    const userId = data.user.id;

    const { error: profileError } = await this.supabaseService.getClient().from('profiles').upsert({
      id: userId,
      email,
      phone,
      full_name,
    }, { onConflict: 'id' });

    if (profileError) {
      this.logger.warn(`Profile insert failed for ${userId}: ${profileError.message}`);
    }

    const roleId = await this.getRoleId(roleSlug);
    let merchantId: string | undefined;
    let organizationId: string | undefined;

    if (roleSlug === 'merchant') {
      const { data: merchant, error: merchantError } = await this.supabaseService.getClient()
        .from('merchants')
        // Merchants go live immediately, same as a client — only
        // organizations (enterprise accounts) require admin approval.
        .insert({ owner_id: userId, name: business_name, status: 'active', country: 'CD' })
        .select()
        .single();

      if (merchantError) {
        this.logger.warn(`Merchant creation failed for ${userId}: ${merchantError.message}`);
      } else {
        merchantId = merchant.id;
        const { error: merchantUserError } = await this.supabaseService.getClient().from('merchant_users').insert({
          merchant_id: merchantId,
          user_id: userId,
          role_id: roleId,
          status: 'active',
        });
        if (merchantUserError) {
          this.logger.warn(`Merchant user link failed for ${userId}: ${merchantUserError.message}`);
        }
      }
    }

    // Same self-signup shape as the merchant branch above, just targeting
    // `organizations` instead of `merchants` — kept inline here rather than
    // delegating to OrganizationsService because that service already
    // depends on AuthService (for generateToken), so importing it back here
    // would create a circular module dependency (same reasoning as
    // PaymentsModule re-declaring wallet providers instead of importing
    // WalletsModule).
    if (roleSlug === 'enterprise') {
      const { data: organization, error: organizationError } = await this.supabaseService.getClient()
        .from('organizations')
        .insert({ owner_id: userId, name: business_name, status: 'pending' })
        .select()
        .single();

      if (organizationError) {
        this.logger.warn(`Organization creation failed for ${userId}: ${organizationError.message}`);
      } else {
        organizationId = organization.id;
      }
    }

    const { error: roleError } = await this.supabaseService.getClient().from('user_roles').upsert({
      user_id: userId,
      role_id: roleId,
      merchant_id: merchantId || null,
      organization_id: organizationId || null,
    }, { onConflict: 'user_id,role_id,merchant_id' });

    if (roleError) {
      this.logger.warn(`Role insert failed for ${userId}: ${roleError.message}`);
    }

    // Every self-registered account (client or merchant) gets a wallet — the
    // wallet_number is filled server-side by a DB trigger (LP-MER-xxxxxx if
    // this account owns a merchant, created just above; LP-xxxxxxxx
    // otherwise). Never blocking: registration must still succeed even if
    // this fails, same tolerance as the other best-effort steps above.
    const { error: walletError } = await this.supabaseService.getClient().from('wallets').insert({ user_id: userId });
    if (walletError) {
      this.logger.warn(`Wallet creation failed for ${userId}: ${walletError.message}`);
    }

    const sessionId = await this.claimSession(userId, roleSlug, dto.device_id);
    await this.recordClientPlatform(userId, ctx.platform);
    const token = await this.generateToken(userId, email, roleSlug, merchantId, sessionId, undefined, organizationId);
    const refreshToken = await this.generateRefreshToken(userId, email, sessionId);
    const supabaseSession = await this.mintSupabaseSession(email, password);

    return {
      user: { id: userId, email, phone, full_name, role: roleSlug, merchant_id: merchantId, organization_id: organizationId },
      access_token: token,
      refresh_token: refreshToken,
      supabase_session: supabaseSession,
    };
  }

  async login(dto: LoginDto, ctx: { ip?: string; userAgent?: string; platform?: string } = {}) {
    const { email, password, device_id } = dto;

    await this.loginAttempts.assertNotLocked(email);

    const { data, error } = await this.supabaseService.getAuthClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      this.logger.error(`Login failed for ${email}: ${error?.message || 'no user returned'}`);
      // Only a 4xx answer from Supabase Auth means the credentials were
      // rejected. A network failure, a 5xx or an unparseable response means
      // Supabase couldn't be reached — reporting that as "Invalid credentials"
      // would send users hunting for a password problem they don't have.
      if (error && !(isAuthApiError(error) && error.status >= 400 && error.status < 500)) {
        throw new ServiceUnavailableException(
          'Le service de connexion est temporairement indisponible. Veuillez réessayer plus tard.',
        );
      }
      // An employee whose access the patron removed: say so instead of "wrong password".
      if (error && /banned/i.test(error.message || '')) {
        throw new ForbiddenException("Votre accès a été retiré. Contactez votre employeur.");
      }
      if (await this.loginAttempts.recordFailure(email)) {
        void this.securityAlerts.alert({
          severity: 'warning',
          title: 'Compte verrouillé après des échecs de connexion',
          body: `${email} : 5 mots de passe incorrects. Connexion bloquée 15 minutes (IP ${ctx.ip || 'inconnue'}).`,
          audience: 'admins',
          dedupeKey: `lock:${email.toLowerCase()}`,
        });
      }
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    await this.loginAttempts.recordSuccess(email);
    const userId = data.user.id;

    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id, organization_id')
      .eq('user_id', userId)
      .single();

    const role = (roleData?.role as any)?.slug || 'client';
    const merchantId = roleData?.merchant_id || undefined;
    const organizationId = roleData?.organization_id || undefined;

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Administrators: password + authenticator code. Without 2FA set up yet
    // they still get in, but only far enough to set it up (JwtAuthGuard).
    let mfaAt: number | undefined;
    let twoFactorSetupRequired = false;
    if (MFA_REQUIRED_ROLES.includes(role)) {
      if (!isAdminIpAllowed(this.configService.get<string>('ADMIN_ALLOWED_IPS'), ctx.ip)) {
        void this.securityAlerts.alert({
          severity: 'critical',
          title: 'Connexion admin refusée : réseau non autorisé',
          body: `${email} s'est connecté avec le bon mot de passe depuis ${ctx.ip || 'une IP inconnue'}, hors de la liste autorisée.`,
          dedupeKey: `admin-ip:${email.toLowerCase()}:${ctx.ip}`,
        });
        throw new ForbiddenException('Accès administrateur refusé depuis ce réseau');
      }
      if (await this.twoFactor.isEnabled(userId)) {
        if (!dto.otp) {
          throw new ForbiddenException({ statusCode: 403, code: 'OTP_REQUIRED', message: "Saisissez le code de votre application d'authentification." });
        }
        if (!(await this.twoFactor.verify(userId, dto.otp))) {
          void this.securityAlerts.alert({
            severity: 'critical',
            title: 'Code 2FA incorrect sur un compte administrateur',
            body: `Quelqu'un connaît le mot de passe de ${email} mais pas le code du téléphone (IP ${ctx.ip || 'inconnue'}).`,
            dedupeKey: `otp-fail:${userId}`,
          });
          throw new UnauthorizedException('Code de double authentification incorrect');
        }
        mfaAt = Math.floor(Date.now() / 1000);
      } else {
        twoFactorSetupRequired = true;
      }
      void this.securityAlerts.alert({
        severity: 'info',
        title: 'Connexion administrateur',
        body: `${email} (${role}) vient de se connecter — IP ${ctx.ip || 'inconnue'}${ctx.userAgent ? `, ${ctx.userAgent.slice(0, 80)}` : ''}. Si ce n'est pas vous, changez le mot de passe et réinitialisez la 2FA.`,
        audience: 'super_admins',
      });
    }

    const sessionId = await this.claimSession(userId, role, device_id);
    await this.recordClientPlatform(userId, ctx.platform);
    const token = await this.generateToken(userId, email, role, merchantId, sessionId, undefined, organizationId, mfaAt);
    const refreshToken = await this.generateRefreshToken(userId, email, sessionId, undefined, undefined, mfaAt, role);

    return {
      user: {
        id: userId,
        email,
        phone: profile?.phone,
        full_name: profile?.full_name,
        role,
        merchant_id: merchantId,
        organization_id: organizationId,
        must_change_password: !!profile?.must_change_password,
        two_factor_setup_required: twoFactorSetupRequired,
      },
      access_token: token,
      refresh_token: refreshToken,
      // Reuse the Supabase Auth session already established above — no need
      // for a second signInWithPassword call like register() needs.
      supabase_session: data.session
        ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
        : null,
    };
  }

  async refresh(refreshToken: string) {
    let payload: {
      sub: string;
      email: string;
      type?: string;
      session_id?: string;
      merchant_id?: string;
      acting_as_org_id?: string;
      mfa?: boolean;
      mfa_at?: number;
    };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: getRequiredJwtSecret(this.configService),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // "Acting as" a specific store's merchant (enterprise owner who entered
    // one of their organization's stores) — re-derived from canonical
    // user_roles below, this would silently collapse back to 'enterprise'
    // on the very next token refresh (access tokens are short-lived). Skip
    // the canonical lookup entirely as long as the grant (still this org's
    // owner, store still theirs) holds; otherwise fall through to the
    // normal canonical refresh, which quietly returns them to their real
    // (enterprise) scope rather than hard-failing the whole refresh.
    if (payload.merchant_id && payload.acting_as_org_id) {
      const stillValid = await this.validateActingAsGrant(payload.sub, payload.merchant_id, payload.acting_as_org_id);
      if (stillValid) {
        if (!SESSION_TRACKING_EXEMPT_ROLES.includes('merchant')) {
          const { data: profile } = await this.supabaseService.getClient()
            .from('profiles')
            .select('active_session_id')
            .eq('id', payload.sub)
            .single();

          if (!profile || profile.active_session_id !== payload.session_id) {
            throw new UnauthorizedException('Session no longer active — please log in again');
          }
        }

        return {
          access_token: await this.generateToken(payload.sub, payload.email, 'merchant', payload.merchant_id, payload.session_id, payload.acting_as_org_id),
          refresh_token: await this.generateRefreshToken(payload.sub, payload.email, payload.session_id, payload.merchant_id, payload.acting_as_org_id),
        };
      }
    }

    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id, organization_id')
      .eq('user_id', payload.sub)
      .single();

    const role = (roleData?.role as any)?.slug || 'client';
    const merchantId = roleData?.merchant_id || undefined;
    const organizationId = roleData?.organization_id || undefined;

    // Admins/super admins are exempt from single-session tracking — skip the
    // check even if this refresh token still carries a session_id minted
    // before that exemption existed.
    if (!SESSION_TRACKING_EXEMPT_ROLES.includes(role)) {
      const { data: profile } = await this.supabaseService.getClient()
        .from('profiles')
        .select('active_session_id')
        .eq('id', payload.sub)
        .single();

      if (!profile || profile.active_session_id !== payload.session_id) {
        throw new UnauthorizedException('Session no longer active — please log in again');
      }
    }

    // Keep (never create) the second-factor proof: a refresh can't turn a
    // password-only admin session into a verified one.
    const mfaAt = payload.mfa === true && MFA_REQUIRED_ROLES.includes(role) ? payload.mfa_at : undefined;
    return {
      access_token: await this.generateToken(payload.sub, payload.email, role, merchantId, payload.session_id, undefined, organizationId, mfaAt),
      refresh_token: await this.generateRefreshToken(payload.sub, payload.email, payload.session_id, undefined, undefined, mfaAt, role),
    };
  }

  /**
   * Leaves "acting as a store" and returns to the account's own scope (the enterprise owner).
   * The web app used to keep the owner's tokens in its own storage to swap them back; a browser
   * that keeps the session in HttpOnly cookies cannot, so the server re-derives them instead —
   * from the canonical role, exactly like a refresh does when the "acting as" grant is gone.
   */
  async exitActingAs(userId: string, email: string, sessionId?: string) {
    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id, organization_id')
      .eq('user_id', userId)
      .single();
    const role = (roleData?.role as any)?.slug || 'client';
    return {
      access_token: await this.generateToken(userId, email, role, roleData?.merchant_id || undefined, sessionId, undefined, roleData?.organization_id || undefined),
      refresh_token: await this.generateRefreshToken(userId, email, sessionId, undefined, undefined, undefined, role),
    };
  }

  /** Confirms an "acting as" grant minted by OrganizationsService.enterMerchant()
   * still holds: the caller still owns that organization, and the store is
   * still part of it. Two cheap point lookups — called on every refresh of
   * a scoped token, since the underlying relationship can change (store
   * detached, org reassigned) after the token was minted. */
  private async validateActingAsGrant(userId: string, merchantId: string, orgId: string): Promise<boolean> {
    const { data: org } = await this.supabaseService.getClient()
      .from('organizations')
      .select('owner_id')
      .eq('id', orgId)
      .single();
    if (!org || org.owner_id !== userId) return false;

    const { data: merchant } = await this.supabaseService.getClient()
      .from('merchants')
      .select('organization_id')
      .eq('id', merchantId)
      .single();
    return !!merchant && merchant.organization_id === orgId;
  }

  /**
   * Remembers where this session was opened (android-app, web…), for the device-integrity rule: a token
   * minted in the Android app stays an Android-app session even if it is replayed from elsewhere.
   * Best effort — migration 054 may not be applied yet, and that must never block a login.
   */
  private async recordClientPlatform(userId: string, platform?: string): Promise<void> {
    try {
      await this.supabaseService.getClient().from('profiles').update({ active_client_platform: cleanPlatform(platform) }).eq('id', userId);
    } catch { /* ignore */ }
  }

  async logout(userId: string): Promise<void> {
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: null })
      .eq('id', userId);
  }

  /** Forced first-login password change (see ForcePasswordChangeGate on the
   * frontend, gated on profiles.must_change_password). Also closes the
   * loop on the enterprise-staff credential lifecycle: if this account was
   * created by OrganizationStaffService.createStaff(), its
   * organization_staff.temp_password row is nulled out right here — the
   * "archived only until first use" rule — and the admin who created it is
   * notified. notifications/organization_staff lookups are best-effort;
   * neither failure should ever block the password itself from changing. */
  async changePassword(userId: string, newPassword: string): Promise<void> {
    const { error } = await this.supabaseService.getClient().auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (error) {
      throw new UnauthorizedException(error.message);
    }

    await this.supabaseService.getClient()
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', userId);

    const { data: staff } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('id, created_by, prenom, nom, temp_password')
      .eq('user_id', userId)
      .maybeSingle();

    if (staff?.temp_password) {
      await this.supabaseService.getClient()
        .from('organization_staff')
        .update({ temp_password: null })
        .eq('id', staff.id);

      await this.notificationsService.create({
        user_id: staff.created_by,
        type: 'staff_password_changed',
        title: 'Mot de passe défini',
        body: `${staff.prenom} ${staff.nom} a défini son propre mot de passe. Le mot de passe temporaire n'est plus disponible.`,
        data: { staff_id: staff.id },
      });
    }
  }

  /**
   * Enforces a single active session per account — but a device that
   * already holds it can always silently reclaim it (e.g. its stored
   * tokens were lost to a network blip rather than an explicit logout; see
   * lib/api.ts on the frontend for the matching fix to stop that from
   * happening unnecessarily). Only a genuinely *different* device_id is
   * blocked, requiring an explicit logout or an admin reset
   * (admin.service.ts resetUserSession) to free the slot — no automatic
   * takeover of someone else's session. Admins/super admins are exempt
   * entirely (see SESSION_TRACKING_EXEMPT_ROLES) — unlimited concurrent
   * devices, active_session_id never touched for them, so the returned
   * session_id is undefined and no per-request check ever runs for their
   * tokens (see JwtStrategy.validate).
   */
  private async claimSession(userId: string, role: string, deviceId?: string): Promise<string | undefined> {
    if (SESSION_TRACKING_EXEMPT_ROLES.includes(role)) {
      return undefined;
    }

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('active_session_id, active_device_id')
      .eq('id', userId)
      .single();

    const sameDeviceReclaiming = !!profile?.active_session_id && !!deviceId && profile.active_device_id === deviceId;

    if (profile?.active_session_id && !sameDeviceReclaiming) {
      throw new ConflictException(
        'Ce compte est déjà connecté sur un autre appareil. Contactez un administrateur pour réinitialiser votre session.',
      );
    }

    const sessionId = uuidv4();
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: sessionId, active_device_id: deviceId || null })
      .eq('id', userId);

    return sessionId;
  }

  /**
   * Surfaces the Supabase Auth session (separate from ScanLinkPay's own JWT) so
   * the frontend can use Supabase Realtime, protected by the existing RLS
   * policies. Best-effort — Realtime is a nice-to-have, never block login.
   */
  private async mintSupabaseSession(email: string, password: string): Promise<{ access_token: string; refresh_token: string } | null> {
    try {
      const { data, error } = await this.supabaseService.getAuthClient().auth.signInWithPassword({ email, password });
      if (error || !data.session) return null;
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    } catch (err: any) {
      this.logger.warn(`Failed to mint Supabase realtime session for ${email}: ${err.message}`);
      return null;
    }
  }

  async generateToken(
    userId: string,
    email: string,
    role: string,
    merchantId?: string,
    sessionId?: string,
    actingAsOrgId?: string,
    organizationId?: string,
    mfaAt?: number,
  ): Promise<string> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      ...(merchantId ? { merchant_id: merchantId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(actingAsOrgId ? { acting_as_org_id: actingAsOrgId } : {}),
      ...(organizationId ? { organization_id: organizationId } : {}),
      ...(mfaAt ? { mfa: true, mfa_at: mfaAt } : {}),
    };
    return this.jwtService.sign(payload);
  }

  async generateRefreshToken(
    userId: string,
    email: string,
    sessionId?: string,
    merchantId?: string,
    actingAsOrgId?: string,
    mfaAt?: number,
    role?: string,
  ): Promise<string> {
    return this.jwtService.sign(
      {
        sub: userId,
        email,
        type: 'refresh',
        ...(sessionId ? { session_id: sessionId } : {}),
        // Only ever set together — an "acting as" refresh token needs
        // merchant_id to know which store to re-validate against on the
        // next refresh (validateActingAsGrant above); a normal refresh
        // token deliberately carries no merchant_id, since a real role
        // change is always re-derived from user_roles on every refresh.
        ...(merchantId && actingAsOrgId ? { merchant_id: merchantId, acting_as_org_id: actingAsOrgId } : {}),
        ...(mfaAt ? { mfa: true, mfa_at: mfaAt } : {}),
      },
      // Long-lived by design ("remember me" — stay logged in like Facebook,
      // never a silent timeout): the actual security boundary is
      // active_session_id, re-checked on every refresh() and every request
      // via JwtStrategy, not this expiry. Only an explicit logout or an
      // admin session reset can end a session; this default just keeps the
      // refresh token from being the thing that logs someone out first.
      {
        // Administrators don't get the year-long "stay logged in": a refresh
        // token lifted from an admin's browser must die within the day.
        expiresIn: role && MFA_REQUIRED_ROLES.includes(role)
          ? this.configService.get<string>('ADMIN_REFRESH_EXPIRES_IN', '12h')
          : this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '365d'),
      },
    );
  }

  private async getRoleId(slug: string): Promise<string> {
    const { data, error } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      throw new Error(`Role "${slug}" not found. Run migrations first.`);
    }

    return data.id;
  }

  async validateUser(payload: JwtPayload) {
    return payload;
  }
}
