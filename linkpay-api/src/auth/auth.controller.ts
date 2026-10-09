import { Throttle } from '@nestjs/throttler';
import { Controller, Post, Put, Get, Body, HttpCode, HttpStatus, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { AuthService } from './auth.service';
import { TwoFactorService } from '../security/two-factor.service';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { AllowWithoutMfa } from '../common/decorators/allow-without-mfa.decorator';
import { MFA_REQUIRED_ROLES } from './constants';
import { RegisterDto, LoginDto } from './dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class RefreshDto {
  @ApiProperty()
  @IsString()
  refresh_token!: string;
}

class ChangePasswordDto {
  @ApiProperty({ example: 'un-nouveau-mot-de-passe' })
  @IsString()
  @MinLength(8)
  new_password!: string;
}

class EnableTwoFactorDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private twoFactor: TwoFactorService,
    private securityAlerts: SecurityAlertsService,
  ) {}

  // Strict per-IP budgets on the public auth endpoints (the global 100/min is
  // far too generous for them): slows credential stuffing and mass sign-ups.
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new client account' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 503, description: 'Supabase Auth unreachable' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, { ip: req.ip, userAgent: req.headers?.['user-agent'] });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Put('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current user\'s password (used for the forced first-login change)' })
  async changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(userId, dto.new_password);
    return { success: true };
  }

  @AllowWithoutMfa()
  @Get('2fa/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Is the authenticator-app login set up for this account?' })
  async twoFactorStatus(@CurrentUser('id') userId: string, @CurrentUser('mfa') mfa?: boolean) {
    return { enabled: await this.twoFactor.isEnabled(userId), verified_session: !!mfa };
  }

  @AllowWithoutMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/setup')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start authenticator-app setup (administrators): returns the secret and a QR code' })
  async twoFactorSetup(@CurrentUser('id') userId: string, @CurrentUser('email') email: string, @CurrentUser('role') role: string) {
    if (!MFA_REQUIRED_ROLES.includes(role)) throw new ForbiddenException();
    return this.twoFactor.beginSetup(userId, email);
  }

  @AllowWithoutMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the first code: turns 2FA on, returns recovery codes (shown once) and verified tokens' })
  async twoFactorEnable(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('role') role: string,
    @Body() dto: EnableTwoFactorDto,
  ) {
    if (!MFA_REQUIRED_ROLES.includes(role)) throw new ForbiddenException();
    const recovery_codes = await this.twoFactor.confirmSetup(userId, dto.code);
    const mfaAt = Math.floor(Date.now() / 1000);
    void this.securityAlerts.alert({
      severity: 'info',
      title: 'Double authentification activée',
      body: `${email} a activé la double authentification.`,
      audience: 'super_admins',
    });
    return {
      recovery_codes,
      access_token: await this.authService.generateToken(userId, email, role, undefined, undefined, undefined, undefined, mfaAt),
      refresh_token: await this.authService.generateRefreshToken(userId, email, undefined, undefined, undefined, mfaAt, role),
    };
  }

  @AllowWithoutMfa()
  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out and free this account for another device' })
  async logout(@CurrentUser('id') userId: string) {
    await this.authService.logout(userId);
    return { success: true };
  }
}
