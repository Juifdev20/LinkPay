import { Throttle } from '@nestjs/throttler';
import { Controller, Post, Put, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out and free this account for another device' })
  async logout(@CurrentUser('id') userId: string) {
    await this.authService.logout(userId);
    return { success: true };
  }
}
