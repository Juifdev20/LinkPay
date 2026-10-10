import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ManualWithdrawalsService } from './manual-withdrawals.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { toLimit } from '../common/utils/pagination';

export class MarkSentDto {
  @ApiPropertyOptional({ description: 'Reference of the transfer you made (transaction number)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

export class RejectWithdrawalDto {
  @ApiProperty({ description: 'Why the withdrawal is refused (shown to the person; the money goes back to the wallet)' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

/** Withdrawals the payment provider cannot send: an admin sends the money by hand and records it here. */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/withdrawals')
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
export class ManualWithdrawalsController {
  constructor(private manual: ManualWithdrawalsService) {}

  @Get()
  @ApiOperation({ summary: 'Withdrawals to send by hand (status=open) or the last ones settled (status=done)' })
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.manual.list(status === 'done' ? 'done' : 'open', toLimit(limit));
  }

  @Post(':id/sent')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'I sent the money: the withdrawal is done' })
  sent(@CurrentUser('id') adminId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkSentDto) {
    return this.manual.markSent(adminId, id, dto.reference);
  }

  @Post(':id/reject')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Refuse the withdrawal: amount and fee go back to the wallet' })
  reject(@CurrentUser('id') adminId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectWithdrawalDto) {
    return this.manual.reject(adminId, id, dto.reason);
  }
}
