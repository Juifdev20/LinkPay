import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, UseInterceptors, UploadedFile, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, IsObject, IsBoolean, MaxLength, Min, MinLength, IsUUID } from 'class-validator';
import { StockService } from './stock.service';
import { SuppliersService } from './suppliers.service';
import { StockPasswordService } from './stock-password.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireSubscription } from '../subscriptions/subscription.guard';
import { AppCodeConfirmGuard, RequireAppCode } from '../common/guards/app-code-confirm.guard';

const CONDITIONS = ['neuf', 'occasion', 'reconditionne'];
const MOVEMENT_TYPES = ['in', 'out', 'adjustment'];
export const STOCK_CATEGORIES = ['telephonie_mobilite', 'ordinateurs', 'composants_informatiques', 'audio_hifi', 'accessoires'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

class CreateStockItemDto {
  @ApiProperty({ example: 'Samsung Galaxy A54' })
  @IsString()
  @MaxLength(255)
  name!: string;

  // Free text, not the electronics-sector enum — the supermarket module
  // uses open rayon names ("Boulangerie", "Hygiène"…). STOCK_CATEGORIES
  // values stay valid; the enum is a frontend suggestion list only.
  @ApiPropertyOptional({ example: 'Boissons' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: '6181155210001', description: 'Code-barres EAN/UPC — unique par boutique' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({ example: 'Smartphone', description: "Sous-type libre à l'intérieur de la catégorie" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  item_type?: string;

  @ApiPropertyOptional({ description: 'Spécifications propres à la catégorie (stockage, RAM, connecteur, etc.)' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'Galaxy A54' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: '359123456789012' })
  @IsOptional()
  @IsString()
  serial_number?: string;

  @ApiPropertyOptional({ enum: CONDITIONS })
  @IsOptional()
  @IsIn(CONDITIONS)
  condition?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  warranty_months?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 45000000, description: 'Prix de vente en centimes' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unit_price_cents?: number;

  @ApiPropertyOptional({ example: 35000000, description: "Prix d'achat en centimes" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost_price_cents?: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;

  @ApiPropertyOptional({ description: "Fournisseur choisi dans la liste de l'entreprise ; null pour l'enlever" })
  @IsOptional()
  @IsUUID()
  supplier_id?: string | null;

  @ApiPropertyOptional({ example: 'Bralima', description: 'Fournisseur tapé à la main : retrouvé par son nom, sinon ajouté à la liste' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplier_name?: string | null;
}

// Editing is gated behind the module's shared stock password — see
// StockPasswordService, when the owner switched it on (checked server-side,
// so a direct API call can't bypass the UI gate).
class UpdateStockItemDto extends CreateStockItemDto {
  @ApiPropertyOptional({ description: "Mot de passe de gestion de stock — seulement si le patron l'a activé" })
  @IsOptional()
  @IsString()
  stock_password?: string;
}

class DeleteStockItemDto {
  @ApiPropertyOptional({ description: "Mot de passe de gestion de stock — seulement si le patron l'a activé" })
  @IsOptional()
  @IsString()
  stock_password?: string;
}

class CreateMovementDto {
  @ApiProperty({ enum: MOVEMENT_TYPES })
  @IsIn(MOVEMENT_TYPES)
  type!: 'in' | 'out' | 'adjustment';

  @ApiProperty({ example: 10, description: 'Positif pour un réapprovisionnement, négatif pour une perte/casse' })
  @IsNumber()
  quantity_delta!: number;

  @ApiPropertyOptional({ example: 'Réapprovisionnement fournisseur' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: "Id créé sur l'appareil pour un mouvement fait hors ligne : envoyé deux fois, il est gardé une fois" })
  @IsOptional()
  @IsUUID()
  client_ref?: string;
}

class SetStockPasswordDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  @MinLength(4)
  password!: string;

  @ApiPropertyOptional({ description: 'Requis si un mot de passe existe déjà' })
  @IsOptional()
  @IsString()
  current_password?: string;
}

class ResetStockPasswordDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  @MinLength(4)
  new_password!: string;
}

class StockPasswordRequiredDto {
  @ApiProperty()
  @IsBoolean()
  required!: boolean;
}

class VerifyStockPasswordDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  password!: string;
}

/**
 * Who may touch an organization's shared stock password.
 *  - define / change it: the patron (owner) or an administrator — never an employee;
 *  - check it or ask whether one exists: the patron, the organization's own
 *    staff (they need it to confirm an edit) and administrators — nobody else,
 *    so another company's account can neither guess it nor lock it by failing.
 */
export function assertStockPasswordAccess(
  org: { id: string; owner_id: string },
  caller: { id: string; role?: string; organizationId?: string },
  level: 'member' | 'manager' | 'owner',
) {
  const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
  const isOwner = org.owner_id === caller.id;
  if (isAdmin || isOwner) return;
  const sameOrg = !!caller.organizationId && caller.organizationId === org.id;
  if (level === 'member' && sameOrg) return;
  // Trying the password counts toward a lockout of the whole company's stock edits: only people who actually manage
  // stock may try it (a seller or cashier guessing could otherwise lock the stock keeper out).
  if (level === 'manager' && sameOrg && caller.role === 'magasinier') return;
  throw new ForbiddenException(
    level === 'owner'
      ? "Seul le patron peut définir ou modifier le mot de passe de gestion de stock."
      : "Vous n'avez pas accès à la gestion de stock de cette entreprise",
  );
}

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('merchants')
export class StockController {
  constructor(private stockService: StockService) {}

  @Post(':id/stock-items')
  @RequireSubscription('merchant')
  @ApiOperation({ summary: 'Create a stock item for this store (owner or magasinier). Needs the stock password (x-stock-password header).' })
  async createItem(
    @Param('id') merchantId: string,
    @Body() dto: CreateStockItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @Headers('x-stock-password') stockPassword: string | undefined,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    await this.stockService.assertManagementPassword(merchantId, callerId, callerRole, callerOrgId, stockPassword);
    return this.stockService.createItem(merchantId, callerId, callerRole, callerOrgId, dto);
  }

  @Get(':id/stock-items')
  @ApiOperation({ summary: 'List stock items for this store (owner or magasinier)' })
  async listItems(
    @Param('id') merchantId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.listItems(merchantId, callerId, callerRole, callerOrgId);
  }

  @Get(':id/stock-items/by-barcode/:barcode')
  @ApiOperation({ summary: 'Look up a sellable product by barcode — POS scan (owner, magasinier, vendeur or caissier)' })
  async getItemByBarcode(
    @Param('id') merchantId: string,
    @Param('barcode') barcode: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getItemByBarcode(merchantId, barcode, callerId, callerRole, callerOrgId);
  }

  @Get(':id/stock-items/search')
  @ApiOperation({ summary: 'Search sellable products by name — POS search (owner, magasinier, vendeur or caissier)' })
  async searchSellableItems(
    @Param('id') merchantId: string,
    @Query('q') query: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.searchSellableItems(merchantId, query || '', callerId, callerRole, callerOrgId);
  }

  @Post(':id/stock-items/image')
  @RequireSubscription('merchant')
  @ApiOperation({ summary: "Upload a stock item's product image (max 2 Mo) — returns its public URL" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(
    @Param('id') merchantId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.uploadItemImage(merchantId, callerId, callerRole, callerOrgId, file);
  }

  @Put(':id/stock-items/:itemId')
  @RequireSubscription('merchant')
  @ApiOperation({ summary: 'Update a stock item (owner or magasinier). A changed quantity is recorded as an adjustment movement. Requires the stock password.' })
  async updateItem(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateStockItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const { stock_password, ...updates } = dto;
    return this.stockService.updateItem(merchantId, itemId, callerId, callerRole, callerOrgId, updates, stock_password);
  }

  @Delete(':id/stock-items/:itemId')
  @RequireSubscription('merchant')
  @ApiOperation({ summary: 'Delete a stock item (owner or magasinier). Requires the stock password.' })
  async deleteItem(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: DeleteStockItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.deleteItem(merchantId, itemId, callerId, callerRole, callerOrgId, dto.stock_password);
  }

  @Post(':id/stock-items/:itemId/movements')
  @RequireSubscription('merchant')
  @ApiOperation({ summary: 'Record a restock, loss or correction for a stock item (owner or magasinier)' })
  async createMovement(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateMovementDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @Headers('x-stock-password') stockPassword: string | undefined,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    await this.stockService.assertManagementPassword(merchantId, callerId, callerRole, callerOrgId, stockPassword);
    return this.stockService.createMovement(merchantId, itemId, callerId, callerRole, callerOrgId, dto);
  }

  @Get(':id/stock-items/:itemId/movements')
  @ApiOperation({ summary: 'List the movement history for a stock item (owner or magasinier)' })
  async listMovements(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.listMovements(merchantId, itemId, callerId, callerRole, callerOrgId);
  }
}

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationStockController {
  constructor(
    private stockService: StockService,
    private stockPasswordService: StockPasswordService,
    private organizationsService: OrganizationsService,
  ) {}

  @Get(':id/stock-items')
  @ApiOperation({ summary: "List stock across every store of this organization (owner or magasinier) — the 'sees everything' admin view" })
  async getOrgStockItems(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getOrgStockItems(orgId, callerId, callerRole, callerOrgId);
  }

  @Get(':id/stock-summary')
  @ApiOperation({ summary: 'Aggregated stock stats across every store of this organization (owner or magasinier)' })
  async getOrgStockSummary(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getOrgStockSummary(orgId, callerId, callerRole, callerOrgId);
  }

  @Get(':id/stock-recent-activity')
  @ApiOperation({ summary: 'Movement chart + recent activity feed for the magasinier dashboard. Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to last 7 days).' })
  async getOrgRecentActivity(
    @Param('id') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser('id') callerId?: string,
    @CurrentUser('role') callerRole?: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getOrgRecentActivity(orgId, callerId!, callerRole!, callerOrgId, from, to);
  }

  @Get(':id/stock-password/status')
  @ApiOperation({ summary: 'Whether this organization has a stock management password set yet' })
  async getStockPasswordStatus(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    assertStockPasswordAccess(await this.organizationsService.getOrganizationById(orgId), { id: callerId, role: callerRole, organizationId: callerOrgId }, 'member');
    const [isSet, required] = await Promise.all([
      this.stockPasswordService.hasPasswordSet(orgId),
      this.stockPasswordService.isRequired(orgId),
    ]);
    return { is_set: isSet, required };
  }

  // Switching the protection off removes a control: the owner confirms with their access code.
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Put(':id/stock-password/required')
  @ApiOperation({ summary: 'Switch the stock password on or off (owner only) — off by default' })
  async setStockPasswordRequired(
    @Param('id') orgId: string,
    @Body() dto: StockPasswordRequiredDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    assertStockPasswordAccess(org, { id: callerId, role: callerRole, organizationId: callerOrgId }, 'owner');
    await this.stockPasswordService.setRequired(orgId, dto.required);
    return { required: dto.required };
  }

  @Post(':id/stock-password/verify')
  @ApiOperation({ summary: 'Verify the stock password — used by the edit/delete confirm prompt' })
  async verifyStockPassword(
    @Param('id') orgId: string,
    @Body() dto: VerifyStockPasswordDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    assertStockPasswordAccess(await this.organizationsService.getOrganizationById(orgId), { id: callerId, role: callerRole, organizationId: callerOrgId }, 'manager');
    await this.stockPasswordService.verifyPassword(orgId, dto.password);
    return { ok: true };
  }

  @Post(':id/stock-password/set')
  @ApiOperation({ summary: 'Set the stock password for the first time, or change it by providing the current one (patron / administrator only)' })
  async setStockPassword(
    @Param('id') orgId: string,
    @Body() dto: SetStockPasswordDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    assertStockPasswordAccess(org, { id: callerId, role: callerRole, organizationId: callerOrgId }, 'owner');
    await this.stockPasswordService.setPassword(orgId, dto.password, dto.current_password);
    return { success: true };
  }

  @Post(':id/stock-password/reset')
  @ApiOperation({ summary: "Owner-only override — resets the stock password without knowing the current one" })
  async resetStockPassword(
    @Param('id') orgId: string,
    @Body() dto: ResetStockPasswordDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    const isAdmin = callerRole === 'admin' || callerRole === 'super_admin';
    if (!isAdmin && org.owner_id !== callerId) {
      throw new ForbiddenException("Seul l'administrateur de l'entreprise peut réinitialiser ce mot de passe");
    }
    await this.stockPasswordService.resetPassword(orgId, dto.new_password);
    return { success: true };
  }
}

class SupplierDto {
  @ApiPropertyOptional({ example: 'Bralima' }) @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

/** An enterprise's suppliers (migration 083) — optional on every product, all sectors. */
@ApiTags('Stock')
@ApiBearerAuth()
@Controller('organizations')
export class SuppliersController {
  constructor(private suppliers: SuppliersService) {}

  @Get(':id/suppliers')
  @ApiOperation({ summary: "The enterprise's suppliers (owner, manager, stock keeper, accountant)" })
  list(@Param('id') orgId: string, @CurrentUser() caller: any) {
    return this.suppliers.list(orgId, caller);
  }

  @Post(':id/suppliers')
  @ApiOperation({ summary: 'Add a supplier — gives back the existing one when the name is already on the list' })
  create(@Param('id') orgId: string, @Body() dto: SupplierDto, @CurrentUser() caller: any) {
    return this.suppliers.create(orgId, caller, dto);
  }

  @Put(':id/suppliers/:supplierId')
  @ApiOperation({ summary: 'Change a supplier (name, contact, notes)' })
  update(@Param('id') orgId: string, @Param('supplierId') supplierId: string, @Body() dto: SupplierDto, @CurrentUser() caller: any) {
    return this.suppliers.update(orgId, supplierId, caller, dto);
  }

  @Delete(':id/suppliers/:supplierId')
  @ApiOperation({ summary: 'Take a supplier off the list (archived: products keep showing it)' })
  archive(@Param('id') orgId: string, @Param('supplierId') supplierId: string, @CurrentUser() caller: any) {
    return this.suppliers.archive(orgId, supplierId, caller);
  }
}
