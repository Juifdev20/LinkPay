import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto, LoginDto } from './dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  merchant_id?: string;
  session_id?: string;
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
    const roleSlug = account_type === 'merchant' ? 'merchant' : 'client';

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

    const { error: roleError } = await this.supabaseService.getClient().from('user_roles').upsert({
      user_id: userId,
      role_id: roleId,
      merchant_id: merchantId || null,
    }, { onConflict: 'user_id,role_id,merchant_id' });

    if (roleError) {
      this.logger.warn(`Role insert failed for ${userId}: ${roleError.message}`);
    }

    const sessionId = await this.claimSession(userId);
    const token = await this.generateToken(userId, email, roleSlug, merchantId, sessionId);
    const refreshToken = await this.generateRefreshToken(userId, email, sessionId);
    const supabaseSession = await this.mintSupabaseSession(email, password);

    return {
      user: { id: userId, email, phone, full_name, role: roleSlug, merchant_id: merchantId },
      access_token: token,
      refresh_token: refreshToken,
      supabase_session: supabaseSession,
    };
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;

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

    const sessionId = await this.claimSession(userId);
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
    let payload: { sub: string; email: string; type?: string; session_id?: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET', 'fallback-secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('active_session_id')
      .eq('id', payload.sub)
      .single();

    if (!profile || profile.active_session_id !== payload.session_id) {
      throw new UnauthorizedException('Session no longer active — please log in again');
    }

    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id')
      .eq('user_id', payload.sub)
      .single();

    const role = (roleData?.role as any)?.slug || 'client';
    const merchantId = roleData?.merchant_id || undefined;

    return {
      access_token: await this.generateToken(payload.sub, payload.email, role, merchantId, payload.session_id),
      refresh_token: await this.generateRefreshToken(payload.sub, payload.email, payload.session_id!),
    };
  }

  async logout(userId: string): Promise<void> {
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: null })
      .eq('id', userId);
  }

  /**
   * Enforces a single active session per account. Throws if another device
   * currently holds the session — only an explicit logout or an admin reset
   * (admin.service.ts resetUserSession) frees it, no automatic takeover.
   */
  private async claimSession(userId: string): Promise<string> {
    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('active_session_id')
      .eq('id', userId)
      .single();

    if (profile?.active_session_id) {
      throw new ConflictException(
        'Ce compte est déjà connecté sur un autre appareil. Contactez un administrateur pour réinitialiser votre session.',
      );
    }

    const sessionId = uuidv4();
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: sessionId })
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
  ): Promise<string> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      ...(merchantId ? { merchant_id: merchantId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    };
    return this.jwtService.sign(payload);
  }

  private async generateRefreshToken(userId: string, email: string, sessionId: string): Promise<string> {
    return this.jwtService.sign(
      { sub: userId, email, type: 'refresh', session_id: sessionId },
      { expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') },
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
