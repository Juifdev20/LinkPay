import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsIn, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  // Optional: many people have a phone number but no email. Given, it lets them recover the account by email.
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8, example: 'Password123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  // The account's identifier: a DRC number (+243 and 9 digits), normalized by the service.
  @ApiProperty({ example: '+243812345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional({ example: 'Jean Mukendi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @ApiPropertyOptional({ enum: ['client', 'merchant', 'enterprise'], default: 'client', description: 'Type of account to create' })
  @IsOptional()
  @IsIn(['client', 'merchant', 'enterprise'])
  account_type?: 'client' | 'merchant' | 'enterprise';

  @ApiPropertyOptional({ example: 'Boutique Mukendi', description: 'Required when account_type is "merchant" or "enterprise" — the store name or the company name, respectively' })
  @ValidateIf((o) => o.account_type === 'merchant' || o.account_type === 'enterprise')
  @IsString()
  @MaxLength(255)
  business_name?: string;

  @ApiPropertyOptional({ description: 'Client-generated UUID identifying this browser/app install, persisted across restarts — lets this same device silently reclaim its session later instead of hitting the single-session conflict.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_id?: string;
}

export class LoginDto {
  // One of the two: the phone number (the default), or the email (older accounts, administrators).
  @ApiPropertyOptional({ example: '+243812345678' })
  @ValidateIf((o) => !o.email)
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((o) => !o.phone)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({ description: "Authenticator-app code (or a recovery code) — required for administrator accounts" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  otp?: string;

  @ApiPropertyOptional({ description: 'Client-generated UUID identifying this browser/app install, persisted across restarts — lets this same device silently reclaim its session later instead of hitting the single-session conflict.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_id?: string;
}

/** Forgotten password, with the recovery code given at sign-up. */
export class RecoverWithCodeDto {
  @ApiProperty({ example: '+243812345678' }) @IsString() @MaxLength(20) phone!: string;
  @ApiProperty({ example: 'K7PM-3QX9-T2WA' }) @IsString() @MaxLength(40) recovery_code!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) new_password!: string;
}

/** Forgotten password, by email (accounts that gave one). */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' }) @IsEmail() email!: string;
}

/** The new password, with the token from the email's reset link. */
export class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(4096) access_token!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) new_password!: string;
}

/** A new recovery code for a signed-in account (older accounts have none): the password proves it's them. */
export class RecoveryCodeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) current_password!: string;
}
