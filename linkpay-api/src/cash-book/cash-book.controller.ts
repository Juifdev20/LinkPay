import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CashBookService } from './cash-book.service';
import { CashUnlockService } from './cash-unlock.service';
import { AppCodeConfirmGuard, RequireAppCode } from '../common/guards/app-code-confirm.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireSubscription } from '../subscriptions/subscription.guard';

class CloseDayDto {
  @ApiProperty({ example: '2026-10-22', description: "Jour à clôturer (fuseau de l'entreprise)" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiProperty({ example: 5420000, description: 'Espèces comptées dans la caisse, en centimes' })
  @IsInt()
  @Min(0)
  counted_cents!: number;

  @ApiPropertyOptional({ description: "Solde d'ouverture déclaré — seulement pour la toute première clôture de la station" })
  @IsOptional()
  @IsInt()
  @Min(0)
  opening_cents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class ReopenDto {
  @ApiProperty({ description: 'Motif de la réouverture (tracé)' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class SetSecretDto {
  @ApiProperty({ description: 'Nouveau code secret (6 caractères minimum)' })
  @IsString()
  @MaxLength(64)
  secret!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  confirm!: string;

  @ApiPropertyOptional({ description: 'Code actuel — obligatoire pour le changer' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  current?: string;

  @ApiPropertyOptional({ description: 'Station depuis laquelle le code est créé (historique)' })
  @IsOptional()
  @IsString()
  merchant_id?: string;
}

class UnlockDto {
  @ApiProperty({ description: 'Code secret de déverrouillage' })
  @IsString()
  @MaxLength(64)
  secret!: string;

  @ApiProperty({ description: "Motif de l'urgence (tracé)" })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

class CreateExpenseDto {
  @ApiProperty({ example: 500000 })
  @IsInt()
  @Min(1)
  amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiProperty({ example: 'Transport' })
  @IsString()
  @MaxLength(60)
  category!: string;

  @ApiProperty({ example: 'Course moto pour livraison' })
  @IsString()
  @MaxLength(500)
  description!: string;
}

class RejectExpenseDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/** The station's cash book: day journal, monthly book, reports, daily closing, expenses to validate. */
@ApiTags('Cash Book')
@ApiBearerAuth()
@Controller()
@RequireSubscription('merchant')
@Roles('enterprise', 'gerant', 'caissier', 'vendeur', 'comptable', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class CashBookController {
  constructor(private cashBook: CashBookService, private unlock: CashUnlockService) {}

  @Get('merchants/:id/cash-book/day')
  @ApiOperation({ summary: 'Journal de caisse du jour : ouverture, encaissements, décaissements, caisse théorique' })
  day(
    @Param('id') id: string,
    @Query('date') date: string | undefined,
    @Query('currency') currency = 'CDF',
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.dayView(id, date, currency, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/month')
  @ApiOperation({ summary: "Livre de caisse mensuel : écritures chronologiques, solde d'ouverture et de clôture" })
  month(
    @Param('id') id: string,
    @Query('month') month: string | undefined,
    @Query('currency') currency = 'CDF',
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.monthBook(id, month, currency, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/report')
  @ApiOperation({ summary: 'Rapport financier de la station : jour, semaine, mois ou année' })
  report(
    @Param('id') id: string,
    @Query('period') period = 'month',
    @Query('date') date: string | undefined,
    @Query('currency') currency = 'CDF',
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.report(id, period, date, currency, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/archive')
  @ApiOperation({ summary: 'Classeurs de la station : une entrée par année, de la plus ancienne activité à aujourd\'hui' })
  archive(
    @Param('id') id: string,
    @Query('currency') currency = 'CDF',
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.archive(id, currency, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/closings')
  @ApiOperation({ summary: 'Clôtures de caisse de la station' })
  closings(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.listClosings(id, from, to, callerId!, callerRole!, callerOrgId);
  }

  @Post('merchants/:id/cash-book/closings')
  @ApiOperation({ summary: "Clôturer la caisse d'un jour (comptage des espèces) — verrouille la journée" })
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  close(
    @Param('id') id: string,
    @Body() dto: CloseDayDto,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.closeDay(id, dto, callerId!, callerRole!, callerOrgId);
  }

  @Post('merchants/:id/cash-book/closings/:closingId/reopen')
  @ApiOperation({ summary: 'Rouvrir une journée clôturée (gérant ou patron, motif obligatoire)' })
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  reopen(
    @Param('id') id: string,
    @Param('closingId') closingId: string,
    @Body() dto: ReopenDto,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.reopenDay(id, closingId, dto.reason, callerId!, callerRole!, callerOrgId);
  }

  @Get('cash-book/unlock/status')
  @ApiOperation({ summary: 'Mon code secret de déverrouillage est-il défini ? Est-il bloqué ?' })
  unlockStatus(@CurrentUser('id') callerId?: string) {
    return this.unlock.status(callerId!);
  }

  @Post('cash-book/unlock/secret')
  @ApiOperation({ summary: 'Créer ou changer mon code secret de déverrouillage de caisse' })
  setSecret(@Body() dto: SetSecretDto, @CurrentUser('id') callerId?: string) {
    return this.unlock.setSecret(callerId!, dto, dto.merchant_id);
  }

  @Post('merchants/:id/cash-book/closings/:closingId/unlock')
  @ApiOperation({ summary: "Déverrouiller en urgence la journée clôturée : code secret + motif (tracé)" })
  unlockDay(
    @Param('id') id: string,
    @Param('closingId') closingId: string,
    @Body() dto: UnlockDto,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.unlock.unlockDay(id, closingId, dto, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/unlock-events')
  @ApiOperation({ summary: 'Historique des déverrouillages et essais de la station (date, heure, motif)' })
  unlockEvents(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.unlock.listEvents(id, from, to, callerId!, callerRole!, callerOrgId);
  }

  @Get('merchants/:id/cash-book/expenses')
  @ApiOperation({ summary: 'Dépenses de la station (filtre : pending, approved, rejected)' })
  expenses(
    @Param('id') id: string,
    @Query('status') status: string | undefined,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.listExpenses(id, status, callerId!, callerRole!, callerOrgId);
  }

  @Post('merchants/:id/cash-book/expenses')
  @ApiOperation({ summary: 'Enregistrer une dépense de la caisse (à valider si saisie par un vendeur / caissier)' })
  createExpense(
    @Param('id') id: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.createExpense(id, dto, callerId!, callerRole!, callerOrgId);
  }

  @Post('merchants/:id/cash-book/expenses/:expenseId/approve')
  @ApiOperation({ summary: 'Valider une dépense (gérant ou patron)' })
  approve(
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.reviewExpense(id, expenseId, 'approve', undefined, callerId!, callerRole!, callerOrgId);
  }

  @Post('merchants/:id/cash-book/expenses/:expenseId/reject')
  @ApiOperation({ summary: 'Rejeter une dépense (gérant ou patron, motif obligatoire)' })
  reject(
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
    @Body() dto: RejectExpenseDto,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.reviewExpense(id, expenseId, 'reject', dto.reason, callerId!, callerRole!, callerOrgId);
  }

  @Get('organizations/:id/cash-book/overview')
  @ApiOperation({ summary: 'Clôtures du jour de toutes les stations (patron, comptable)' })
  overview(
    @Param('id') orgId: string,
    @Query('date') date: string | undefined,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.cashBook.overview(orgId, date, callerId!, callerRole!, callerOrgId);
  }
}
