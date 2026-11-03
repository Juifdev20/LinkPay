import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Appelant } from './gestion-fiscale.service';
import { RapportsFiscauxService } from './rapports-fiscaux.service';

class PeriodeDto {
  @ApiProperty({ example: '2026-11-01T00:00:00+01:00' }) @IsISO8601() debut!: string;
  @ApiProperty({ example: '2026-11-30T23:59:59+01:00' }) @IsISO8601() fin!: string;
}

class ListeRapportsDto {
  @ApiPropertyOptional({ enum: ['X', 'XP', 'Z', 'A'] }) @IsOptional() @IsIn(['X', 'XP', 'Z', 'A']) type?: string;
  @ApiPropertyOptional() @IsOptional() limit?: string;
  @ApiPropertyOptional() @IsOptional() offset?: string;
}

const appelant = (u: any): Appelant => ({ id: u?.id, role: u?.role, organization_id: u?.organization_id });

/** Rapports X, Z et A de la facture normalisée (note de service 01/022, 1.3 et 1.4). */
@ApiTags('Facture normalisée (DGI)')
@ApiBearerAuth()
@Controller('organizations/:orgId/facture-normalisee/rapports')
export class RapportsFiscauxController {
  constructor(private rapports: RapportsFiscauxService) {}

  @Get()
  @ApiOperation({ summary: 'Rapports déjà faits (journal), numéro du prochain Z' })
  liste(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Query() q: ListeRapportsDto) {
    const n = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
    return this.rapports.liste(orgId, appelant(u), { type: q.type, limit: n(q.limit), offset: n(q.offset) });
  }

  @Post('x')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rapport X : depuis le dernier Z, ne ferme rien' })
  x(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.rapports.rapportX(orgId, appelant(u));
  }

  @Post('xp')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rapport X périodique : période choisie (un an au plus)' })
  xp(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: PeriodeDto) {
    return this.rapports.rapportX(orgId, appelant(u), dto);
  }

  @Post('z')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rapport Z : clôture depuis le dernier Z (patron, gérant)' })
  z(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.rapports.rapportZ(orgId, appelant(u));
  }

  @Post('a')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rapport A : articles depuis le dernier rapport A (patron, gérant)' })
  a(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.rapports.rapportA(orgId, appelant(u));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un rapport, tel qu’il a été fait' })
  detail(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any) {
    return this.rapports.detail(orgId, id, appelant(u));
  }

  @Post(':id/impression')
  @ApiOperation({ summary: 'Réimpression (DUPLICATA à partir de la deuxième)' })
  imprimer(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any) {
    return this.rapports.imprimer(orgId, id, appelant(u));
  }
}
