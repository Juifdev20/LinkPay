import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches, IsIn, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, example: 'Password123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: '+243812345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number format' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Jean Mukendi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @ApiPropertyOptional({ enum: ['client', 'merchant'], default: 'client', description: 'Type of account to create' })
  @IsOptional()
  @IsIn(['client', 'merchant'])
  account_type?: 'client' | 'merchant';

  @ApiPropertyOptional({ example: 'Boutique Mukendi', description: 'Required when account_type is "merchant"' })
  @ValidateIf((o) => o.account_type === 'merchant')
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
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({ description: 'Client-generated UUID identifying this browser/app install, persisted across restarts — lets this same device silently reclaim its session later instead of hitting the single-session conflict.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_id?: string;
}
