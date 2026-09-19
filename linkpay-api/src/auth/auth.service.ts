import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto, LoginDto } from './dto';
import { SESSION_TRACKING_EXEMPT_ROLES } from './constants';
import { getRequiredJwtSecret } from './jwt-secret.util';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  merchant_id?: string;
  session_id?: string;
  // Set only on a token minted by OrganizationsService.enterMerchant(): the
  // holder's canonical role (in user_roles) is 'enterprise', owner of this
  // org, and role/merchant_id above are a temporary "acting as that store's
  // merchant" lens — not a permanent role change. See refresh() below.
  acting_as_org_id?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private supabaseService: SupabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
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
        .insert({ owner_id: userId, name: business_name, status: 'pending', country: 'CD' })
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
    const token = await this.generateToken(userId, email, roleSlug, merchantId, sessionId);
    const refreshToken = await this.generateRefreshToken(userId, email, sessionId);
    const supabaseSession = await this.mintSupabaseSession(email, password);

    return {
      user: { id: userId, email, phone, full_name, role: roleSlug, merchant_id: merchantId, organization_id: organizationId },
      access_token: token,
      refresh_token: refreshToken,
      supabase_session: supabaseSession,
    };
  }

  async login(dto: LoginDto) {
    const { email, password, device_id } = dto;

    const { data, error } = await this.supabaseService.getAuthClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      this.logger.error(`Login failed for ${email}: ${error?.message || 'no user returned'}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const userId = data.user.id;

    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id')
      .eq('user_id', userId)
      .single();

    const role = (roleData?.role as any)?.slug || 'client';
    const merchantId = roleData?.merchant_id || undefined;

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const sessionId = await this.claimSession(userId, role, device_id);
    const token = await this.generateToken(userId, email, role, merchantId, sessionId);
    const refreshToken = await this.generateRefreshToken(userId, email, sessionId);

    return {
      user: {
        id: userId,
        email,
        phone: profile?.phone,
        full_name: profile?.full_name,
        role,
        merchant_id: merchantId,
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
      .select('role:roles(slug), merchant_id')
      .eq('user_id', payload.sub)
      .single();

    const role = (roleData?.role as any)?.slug || 'client';
    const merchantId = roleData?.merchant_id || undefined;

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

    return {
      access_token: await this.generateToken(payload.sub, payload.email, role, merchantId, payload.session_id),
      refresh_token: await this.generateRefreshToken(payload.sub, payload.email, payload.session_id),
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

  async logout(userId: string): Promise<void> {
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: null })
      .eq('id', userId);
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
   * Surfaces the Supabase Auth session (separate from LinkPay's own JWT) so
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
  ): Promise<string> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      ...(merchantId ? { merchant_id: merchantId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(actingAsOrgId ? { acting_as_org_id: actingAsOrgId } : {}),
    };
    return this.jwtService.sign(payload);
  }

  async generateRefreshToken(
    userId: string,
    email: string,
    sessionId?: string,
    merchantId?: string,
    actingAsOrgId?: string,
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
      },
      // Long-lived by design ("remember me" — stay logged in like Facebook,
      // never a silent timeout): the actual security boundary is
      // active_session_id, re-checked on every refresh() and every request
      // via JwtStrategy, not this expiry. Only an explicit logout or an
      // admin session reset can end a session; this default just keeps the
      // refresh token from being the thing that logs someone out first.
      { expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '365d') },
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
