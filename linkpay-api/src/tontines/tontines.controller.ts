import { Controller, Get, Post, Body, Param, Headers, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsIn, Min, Max, MaxLength, Length } from 'class-validator';
import { TontinesService } from './tontines.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class CreateTontineDto {
  @ApiProperty({ example: 'Tontine des amies' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 5000000, description: 'Amount in cents' })
  @IsInt()
  @Min(1)
  contribution_amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiProperty({ enum: ['weekly', 'monthly'] })
  @IsIn(['weekly', 'monthly'])
  frequency!: 'weekly' | 'monthly';

  @ApiProperty({ minimum: 3, maximum: 30 })
  @IsInt()
  @Min(3)
  @Max(30)
  max_members!: number;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  grace_period_days?: number;
}

class InviteMemberDto {
  @ApiProperty({ example: 'SLP-00001234' })
  @IsString()
  wallet_number!: string;
}

class ContributeDto {
  @ApiProperty()
  @IsString()
  @Length(4, 4)
  pin!: string;
}

@ApiTags('Tontines')
@ApiBearerAuth()
@Controller('tontines')
export class TontinesController {
  constructor(private tontinesService: TontinesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new tontine/likelemba group (caller becomes the first active member)' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateTontineDto) {
    return this.tontinesService.createGroup(userId, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List tontines the current user belongs to' })
  async mine(@CurrentUser('id') userId: string) {
    return this.tontinesService.getMyGroups(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tontine detail (members, current cycle, who has paid) — members only' })
  async detail(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tontinesService.getGroupDetail(id, userId);
  }

  @Post(':id/invite')
  @ApiOperation({ summary: 'Invite an existing ScanLinkPay user by wallet number (creator only, while forming)' })
  async invite(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: InviteMemberDto) {
    return this.tontinesService.inviteMember(id, userId, dto.wallet_number);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept an invitation to join this tontine' })
  async accept(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tontinesService.respondToInvite(id, userId, true);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline an invitation to join this tontine' })
  async decline(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tontinesService.respondToInvite(id, userId, false);
  }

  @Post(':id/draw')
  @ApiOperation({ summary: 'Draw the random payout order and start cycle 1 (creator only, once the group is full)' })
  async draw(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tontinesService.drawOrder(id, userId);
  }

  @Post(':id/contribute')
  @ApiOperation({ summary: "Pay this cycle's contribution (\"Cotiser\") — a real wallet transfer to the current recipient" })
  async contribute(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ContributeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.tontinesService.contribute(id, userId, dto.pin, idempotencyKey);
  }
}
