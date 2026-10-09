import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import { CashRegisterService } from './cash-register.service';
import { AppCodeConfirmGuard, RequireAppCode } from '../common/guards/app-code-confirm.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

class OpenSessionDto {
  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiProperty({ example: 5000000, description: 'Fond de caisse initial, en centimes' })
  @IsNumber()
  @Min(0)
  opening_float_cents!: number;
}

class CashMovementDto {
  @ApiProperty({ enum: ['cash_in', 'cash_out'] })
  @IsIn(['cash_in', 'cash_out'])
  type!: 'cash_in' | 'cash_out';

  @ApiProperty({ example: 1000000 })
  @IsNumber()
  @Min(1)
  amount_cents!: number;

  @ApiProperty({ required: false, example: 'Dépôt bancaire' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class CloseSessionDto {
  @ApiProperty({ example: 5420000, description: 'Montant compté physiquement à la fermeture, en centimes' })
  @IsNumber()
  @Min(0)
  closing_counted_cents!: number;
}

@ApiTags('Cash Register')
@ApiBearerAuth()
@Controller('merchants/:id/cash-register')
// The stock keeper may sell at the till (so can read/open a session), but only the patron and
// the caissier in charge of it move cash in/out or close it — see the per-method @Roles below.
@Roles('enterprise', 'caissier', 'magasinier', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class CashRegisterController {
  constructor(private cashRegisterService: CashRegisterService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Past sessions, newest first — for reviewing rapprochements after the fact' })
  async listSessions(
    @Param('id') merchantId: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.listSessions(merchantId, callerId, callerRole, callerOrgId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('sessions/current')
  @ApiOperation({ summary: 'The currently open cash-register session for a currency, if any' })
  async getCurrentSession(
    @Param('id') merchantId: string,
    @Query('currency') currency: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.getCurrentSession(merchantId, currency || 'CDF', callerId, callerRole, callerOrgId);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Session detail — movements, tickets, live expected drawer amount' })
  async getSessionDetail(
    @Param('id') merchantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.getSessionDetail(merchantId, sessionId, callerId, callerRole, callerOrgId);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Open a cash-register session with a starting float' })
  async openSession(
    @Param('id') merchantId: string,
    @Body() dto: OpenSessionDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.openSession(merchantId, callerId, callerRole, callerOrgId, dto);
  }

  @Roles('enterprise', 'caissier', 'admin', 'super_admin')
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post('sessions/:sessionId/movements')
  @ApiOperation({ summary: 'Record a manual cash movement (bank deposit, supply purchase, etc.) during an open session' })
  async addMovement(
    @Param('id') merchantId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CashMovementDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.addMovement(merchantId, sessionId, callerId, callerRole, callerOrgId, dto);
  }

  @Roles('enterprise', 'caissier', 'admin', 'super_admin')
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post('sessions/:sessionId/close')
  @ApiOperation({ summary: 'Close the session — counts cash, computes the expected amount and the discrepancy' })
  async closeSession(
    @Param('id') merchantId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CloseSessionDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashRegisterService.closeSession(merchantId, sessionId, callerId, callerRole, callerOrgId, dto);
  }
}
