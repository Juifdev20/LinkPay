import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GestionFiscaleService, Appelant } from './gestion-fiscale.service';
import { MOYENS_PAIEMENT, NATURES_AVOIR, TYPES_ARTICLE, TYPES_CLIENT, TYPES_FACTURE } from './groupes';

class ProfilDto {
  @ApiPropertyOptional({ example: 'A2216742Y' }) @IsOptional() @IsString() @MaxLength(9) nif?: string;
  @ApiPropertyOptional({ enum: ['assujetti', 'non_assujetti'] }) @IsOptional() @IsIn(['assujetti', 'non_assujetti']) vat_regime?: 'assujetti' | 'non_assujetti';
  @ApiPropertyOptional({ enum: ['ttc', 'ht'] }) @IsOptional() @IsIn(['ttc', 'ht']) price_mode?: 'ttc' | 'ht';
  @ApiPropertyOptional({ example: 'B', nullable: true }) @IsOptional() @Matches(/^([A-P])?$/) default_tax_group?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) trade_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) email?: string;
}

class JetonDto {
  @ApiProperty({ description: 'Jeton créé sur le portail e-DEF de la DGI (jamais renvoyé ensuite)' })
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  jeton!: string;
  @ApiPropertyOptional({ enum: ['test', 'production'] }) @IsOptional() @IsIn(['test', 'production']) environnement?: 'test' | 'production';
}

class GroupeCategorieDto {
  @ApiProperty({ example: 'Boissons', description: 'Catégorie telle qu’enregistrée sur les produits' }) @IsString() @MinLength(1) @MaxLength(100) categorie!: string;
  @ApiProperty({ example: 'B', nullable: true, description: 'Groupe de taxation ; null pour l’enlever' }) @Matches(/^[A-P]$/) @IsOptional() groupe!: string | null;
}

class ActivationDto {
  @ApiProperty() @IsBoolean() actif!: boolean;
}

class ClientDto {
  @ApiProperty({ enum: TYPES_CLIENT }) @IsIn(TYPES_CLIENT as unknown as string[]) type!: (typeof TYPES_CLIENT)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(9) nif?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) nom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) contact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250) adresse?: string;
  @ApiPropertyOptional({ description: "Client AO : référence du certificat d'exonération" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceExoneration?: string;
}

class EmissionDto {
  @ApiProperty({ enum: ['pos_ticket', 'sale'] }) @IsIn(['pos_ticket', 'sale']) source_type!: 'pos_ticket' | 'sale';
  @ApiProperty() @IsString() @MaxLength(64) source_id!: string;
  @ApiProperty({ type: ClientDto }) @ValidateNested() @Type(() => ClientDto) client!: ClientDto;
}

class LigneAvoirDto {
  @ApiProperty() @IsString() @MaxLength(64) ligne_id!: string;
  @ApiProperty({ example: '1.5' }) @Matches(/^\d+([.,]\d{1,3})?$/) quantite!: string;
}

class AvoirDto {
  @ApiProperty({ enum: ['COR', 'RAN', 'RAM'] }) @IsIn(['COR', 'RAN', 'RAM']) nature!: 'COR' | 'RAN' | 'RAM';
  @ApiProperty({ description: 'Code PIN du patron ou du gérant' }) @IsString() @Matches(/^\d{4,6}$/) pin!: string;
  @ApiPropertyOptional({ type: [LigneAvoirDto], description: 'Vide = tout ce qui reste remboursable' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LigneAvoirDto)
  lignes?: LigneAvoirDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) motif?: string;
  @ApiPropertyOptional({ enum: MOYENS_PAIEMENT }) @IsOptional() @IsIn(MOYENS_PAIEMENT as unknown as string[]) moyen_remboursement?: (typeof MOYENS_PAIEMENT)[number];
}

class ArticleManuelDto {
  @ApiProperty() @IsString() @MaxLength(200) nom!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) code?: string;
  @ApiProperty({ enum: TYPES_ARTICLE }) @IsIn(TYPES_ARTICLE as unknown as string[]) type!: (typeof TYPES_ARTICLE)[number];
  @ApiProperty({ example: 'B' }) @Matches(/^[A-P]$/) groupe!: any;
  @ApiProperty({ example: 11600, description: 'Prix unitaire en centimes de CDF, dans le mode de la facture' }) @IsInt() @Min(1) prixUnitaireCents!: number;
  @ApiProperty({ example: '2.375' }) @Matches(/^\d+([.,]\d{1,3})?$/) quantite!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) taxeSpecifiqueCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) prixOrigineCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) modificationPrix?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) uniteMesure?: string;
}

class PaiementDto {
  @ApiProperty({ enum: MOYENS_PAIEMENT }) @IsIn(MOYENS_PAIEMENT as unknown as string[]) moyen!: (typeof MOYENS_PAIEMENT)[number];
  @ApiProperty() @IsInt() @Min(1) montantCents!: number;
  @ApiPropertyOptional({ enum: ['USD'] }) @IsOptional() @IsIn(['USD']) devise?: 'USD';
  @ApiPropertyOptional({ example: '2850.5' }) @IsOptional() @Matches(/^\d+(\.\d{1,4})?$/) taux?: string;
}

class ManuelleDto {
  @ApiProperty({ enum: TYPES_FACTURE }) @IsIn(TYPES_FACTURE as unknown as string[]) type!: (typeof TYPES_FACTURE)[number];
  @ApiPropertyOptional({ enum: ['ttc', 'ht'] }) @IsOptional() @IsIn(['ttc', 'ht']) mode?: 'ttc' | 'ht';
  @ApiProperty({ type: [ArticleManuelDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ArticleManuelDto)
  articles!: ArticleManuelDto[];
  @ApiProperty({ type: ClientDto }) @ValidateNested() @Type(() => ClientDto) client!: ClientDto;
  @ApiPropertyOptional({ type: [PaiementDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaiementDto)
  paiements?: PaiementDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(7) @IsString({ each: true }) @MaxLength(120, { each: true }) commentaires?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) reference_derogation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) facture_origine_id?: string;
  @ApiPropertyOptional({ enum: NATURES_AVOIR }) @IsOptional() @IsIn(NATURES_AVOIR as unknown as string[]) nature_avoir?: (typeof NATURES_AVOIR)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{4,6}$/) pin?: string;
}

const appelant = (u: any): Appelant => ({ id: u?.id, role: u?.role, organization_id: u?.organization_id });

@ApiTags('Facture normalisée (DGI)')
@ApiBearerAuth()
@Controller('organizations/:orgId/facture-normalisee')
export class FactureNormaliseeController {
  constructor(private gestion: GestionFiscaleService) {}

  @Get('profil')
  @ApiOperation({ summary: 'Profil fiscal de l’entreprise (sans le jeton) et groupes de taxation' })
  profil(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.gestion.voirProfil(orgId, appelant(u));
  }

  @Put('profil')
  @ApiOperation({ summary: 'Modifier le profil fiscal (patron, gérant)' })
  majProfil(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: ProfilDto) {
    return this.gestion.majProfil(orgId, appelant(u), dto);
  }

  @Post('jeton')
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Enregistrer le jeton e-MCF (essayé auprès de la DGI, chiffré, jamais renvoyé)' })
  jeton(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: JetonDto) {
    return this.gestion.enregistrerJeton(orgId, appelant(u), dto.jeton, dto.environnement ?? 'test');
  }

  @Get('etat')
  @ApiOperation({ summary: 'État en direct de l’e-MCF de l’entreprise' })
  etat(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.gestion.etat(orgId, appelant(u));
  }

  @Get('categories')
  @ApiOperation({ summary: 'Catégories de produits de l’entreprise et groupe de taxation réglé pour chacune' })
  categories(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any) {
    return this.gestion.categories(orgId, appelant(u));
  }

  @Put('categories')
  @ApiOperation({ summary: 'Régler (ou enlever) le groupe de taxation d’une catégorie (patron, gérant)' })
  majCategorie(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: GroupeCategorieDto) {
    return this.gestion.majGroupeCategorie(orgId, appelant(u), dto.categorie, dto.groupe ?? null);
  }

  @Post('activation')
  @ApiOperation({ summary: 'Activer ou désactiver la facture normalisée (patron, gérant)' })
  activer(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: ActivationDto) {
    return this.gestion.activer(orgId, appelant(u), dto.actif);
  }

  @Get('factures')
  @ApiOperation({ summary: 'Factures normalisées de l’entreprise (journal)' })
  liste(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() u: any,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const statut = ['provisional', 'pending', 'confirmed', 'failed', 'abandoned'].includes(status ?? '') ? status : undefined;
    return this.gestion.liste(orgId, appelant(u), { status: statut, limit: Number(limit) || 50, offset: Number(offset) || 0 });
  }

  @Post('factures/manuelle')
  @ApiOperation({ summary: 'Facture saisie à la main (service, remise RRR, cas de test DGI) — patron, gérant' })
  manuelle(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() u: any, @Body() dto: ManuelleDto) {
    return this.gestion.manuelle(orgId, appelant(u), dto);
  }

  @Get('factures/:id')
  @ApiOperation({ summary: 'Facture avec toutes les mentions à imprimer (sans compter une impression)' })
  detail(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any) {
    return this.gestion.detail(orgId, id, appelant(u));
  }

  @Post('factures/:id/impression')
  @ApiOperation({ summary: 'Imprimer : la première fois l’originale, ensuite DUPLICATA (même numéro)' })
  imprimer(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any) {
    return this.gestion.imprimer(orgId, id, appelant(u));
  }

  @Post('factures/:id/reessayer')
  @ApiOperation({ summary: 'Nouvel essai de normalisation (bon provisoire, refus corrigé)' })
  reessayer(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any) {
    return this.gestion.reessayer(orgId, id, appelant(u));
  }

  @Post('factures/:id/avoir')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: 'Facture d’avoir (correction, annulation, reprise) — patron ou gérant, avec code PIN' })
  avoir(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: any, @Body() dto: AvoirDto) {
    return this.gestion.avoir(orgId, id, appelant(u), dto);
  }
}

/** À la caisse et aux ventes : la facture normalisée d'une vente payée. */
@ApiTags('Facture normalisée (DGI)')
@ApiBearerAuth()
@Controller('merchants/:merchantId/facture-normalisee')
export class FactureNormaliseeVenteController {
  constructor(private gestion: GestionFiscaleService) {}

  @Post('emettre')
  @ApiOperation({ summary: 'Émettre la facture normalisée d’un ticket ou d’une vente payés' })
  emettre(@Param('merchantId', ParseUUIDPipe) merchantId: string, @CurrentUser() u: any, @Body() dto: EmissionDto) {
    return this.gestion.emettreDepuisVente(merchantId, appelant(u), { type: dto.source_type, id: dto.source_id }, dto.client);
  }

  @Get('vente')
  @ApiOperation({ summary: 'La facture normalisée d’un ticket ou d’une vente (et si le service est actif)' })
  vente(
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @CurrentUser() u: any,
    @Query('source_type') sourceType: string,
    @Query('source_id') sourceId: string,
  ) {
    const type = sourceType === 'sale' ? 'sale' : 'pos_ticket';
    return this.gestion.factureDeLaVente(merchantId, appelant(u), { type, id: String(sourceId ?? '') });
  }
}
