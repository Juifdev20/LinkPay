import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Appelant } from './gestion-fiscale.service';
import { TestsDgiService } from './tests-dgi.service';

class ClientsTestDto {
  @ApiPropertyOptional({ example: 'A2216742Y' }) @IsOptional() @IsString() @MaxLength(9) nif?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nomPM?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nomPC?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) nomPL?: string;
}

class JouerDto {
  @ApiProperty({ example: '20261103-2130' }) @Matches(/^[A-Za-z0-9-]{1,40}$/) campagne!: string;
  @ApiProperty({ enum: ['ttc', 'ht'] }) @IsIn(['ttc', 'ht']) mode!: 'ttc' | 'ht';
  @ApiProperty({ example: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(29) num!: number;
  @ApiPropertyOptional({ description: 'Code PIN (cas d’avoir)' }) @IsOptional() @Matches(/^\d{4,6}$/) pin?: string;
  @ApiPropertyOptional({ type: ClientsTestDto }) @IsOptional() @ValidateNested() @Type(() => ClientsTestDto) clients?: ClientsTestDto;
}

const appelant = (u: any): Appelant => ({ id: u?.id, role: u?.role, organization_id: u?.organization_id });

/** Cas de test de l'homologation DGI rejoués sur l'e-MCF de test (patron, gérants). */
@ApiTags('Facture normalisée (DGI)')
@ApiBearerAuth()
@Controller('organizations/:orgId/facture-normalisee/tests-dgi')
export class TestsDgiController {
  constructor(private tests: TestsDgiService) {}

  @Get()
  @ApiOperation({ summary: 'Catalogue des cas de test, prérequis, campagnes faites' })
  etat(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.tests.etat(orgId, appelant(u));
  }

  @Get('campagnes/:campagne')
  @ApiOperation({ summary: 'Résultat de chaque cas d’une campagne (TTC et HT)' })
  resultats(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('campagne') campagne: string, @CurrentUser() u: any) {
    return this.tests.resultats(orgId, appelant(u), campagne);
  }

  @Post('jouer')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Jouer un cas de test (crée et fait normaliser sa facture de test)' })
  jouer(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: JouerDto) {
    return this.tests.jouer(orgId, appelant(u), dto);
  }
}
