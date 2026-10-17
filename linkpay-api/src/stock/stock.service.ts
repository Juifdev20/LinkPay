import { Injectable, NotFoundException, ForbiddenException, BadRequestException, HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockPasswordService } from './stock-password.service';
import { AuditService } from '../audit/audit.service';
import { sumByCurrency } from '../common/utils/currency';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Only 'magasinier' can manage stock today — the other enterprise-staff
// roles (vendeur/caissier/comptable) get their own gate once their modules
// (ventes, caisse) land, same reasoning as elsewhere in this codebase of
// only building the access path a real feature needs right now.
const STOCK_STAFF_ROLES = ['magasinier'];
// Read-only stock access (lists, movement history, org summary) — vendeur and
// caissier need it to know what they can sell, but never to change anything.
const STOCK_READ_ROLES = ['magasinier', 'vendeur', 'caissier'];
// Roles that can SELL from the POS till (supermarket module) — selling writes
// a 'sale' stock movement, so it needs more than read but less than the full
// magasinier management access.
export const POS_SALE_ROLES = ['magasinier', 'vendeur', 'caissier'];

@Injectable()
export class StockService {
  constructor(
    private supabaseService: SupabaseService,
    private organizationsService: OrganizationsService,
    private notificationsService: NotificationsService,
    private stockPasswordService: StockPasswordService,
    private auditService: AuditService,
  ) {}

  /**
   * Selling staff (vendeur, caissier) need the catalogue — name, price, quantity
   * — to ring up a sale, but never what the shop paid for it: cost and margin
   * stay with the patron and the stock keeper.
   */
  private redactForRole<T extends Record<string, any>>(item: T, role: string | undefined): T {
    if (role !== 'vendeur' && role !== 'caissier') return item;
    const { cost_price_cents: _cost, ...rest } = item;
    return rest as T;
  }

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  /** A store's stock can be managed by whoever owns the store (a plain
   * merchant owner, or the enterprise owner — createMerchant() always sets
   * merchants.owner_id to the enterprise owner even for org-created stores,
   * so this single check covers both), an org-scoped 'magasinier' of the
   * SAME organization the store belongs to (via the JWT's organization_id —
   * see auth.service.ts), or a platform admin. */
  async resolveMerchantAccess(
    merchantId: string,
    callerId: string | undefined,
    callerRole: string | undefined,
    callerOrgId: string | undefined,
    access: boolean | string[] = false,
  ) {
    const { data: merchant, error } = await this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('id', merchantId)
      .single();

    if (error || !merchant) {
      throw new NotFoundException('Store not found');
    }

    if (this.isAdmin(callerRole)) return merchant;
    if (callerId && merchant.owner_id === callerId) return merchant;
    // `access` accepts the readOnly flag (module callers) or an explicit
    // allowed-roles list (POS passes POS_SALE_ROLES so caissier can sell).
    const allowedRoles = Array.isArray(access)
      ? access
      : access ? STOCK_READ_ROLES : STOCK_STAFF_ROLES;
    if (callerOrgId && merchant.organization_id === callerOrgId && allowedRoles.includes(callerRole || '')) {
      return merchant;
    }

    throw new ForbiddenException('You do not manage this store\'s stock');
  }

  private assertOrgAccess(org: any, callerId: string | undefined, callerRole: string | undefined, callerOrgId: string | undefined, readOnly = false) {
    if (this.isAdmin(callerRole)) return;
    if (callerId && org.owner_id === callerId) return;
    const allowedRoles = readOnly ? STOCK_READ_ROLES : STOCK_STAFF_ROLES;
    if (callerOrgId && org.id === callerOrgId && allowedRoles.includes(callerRole || '')) return;
    throw new ForbiddenException('You do not manage this organization\'s stock');
  }

  /** Unique-constraint violation → a message naming the field that clashes. */
  private throwIfDuplicate(error: { code?: string; message: string }) {
    if (error.code !== '23505' && !/duplicate|unique/i.test(error.message)) return;
    if (error.message.includes('barcode')) {
      throw new BadRequestException('Ce code-barres est déjà utilisé par un autre article de cette boutique.');
    }
    throw new BadRequestException('Un article avec ce numéro de série existe déjà');
  }

  async createItem(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: {
      name: string;
      category?: string;
      item_type?: string;
      attributes?: Record<string, any>;
      image_url?: string;
      description?: string;
      barcode?: string;
      brand?: string;
      model?: string;
      serial_number?: string;
      condition?: string;
      warranty_months?: number;
      quantity?: number;
      unit_price_cents?: number;
      cost_price_cents?: number;
      currency?: string;
      low_stock_threshold?: number;
    },
  ) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data: item, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .insert({
        merchant_id: merchantId,
        name: data.name,
        category: data.category || null,
        item_type: data.item_type || null,
        attributes: data.attributes || {},
        image_url: data.image_url || null,
        description: data.description || null,
        barcode: data.barcode?.trim() || null,
        brand: data.brand || null,
        model: data.model || null,
        serial_number: data.serial_number || null,
        condition: data.condition || null,
        warranty_months: data.warranty_months ?? null,
        quantity: data.quantity ?? 0,
        unit_price_cents: data.unit_price_cents ?? 0,
        cost_price_cents: data.cost_price_cents ?? null,
        currency: data.currency || 'CDF',
        low_stock_threshold: data.low_stock_threshold ?? 5,
        created_by: callerId,
      })
      .select()
      .single();

    if (error) {
      this.throwIfDuplicate(error);
      throw new Error(`Failed to create stock item: ${error.message}`);
    }
    return item;
  }

  async listItems(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, true);

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch stock items: ${error.message}`);
    return (data || []).map((item) => this.redactForRole(item, callerRole));
  }

  /** Both edit and delete are gated behind the organization's shared stock
   * password (StockPasswordService) — consulting the list stays open, but
   * changing anything requires it, verified server-side so a direct API
   * call can't skip the UI prompt. */
  private async assertStockPassword(merchant: any, stockPassword: string | undefined) {
    if (!merchant.organization_id) {
      throw new BadRequestException('Cette boutique ne fait partie d\'aucune entreprise');
    }
    if (!stockPassword) {
      throw new BadRequestException('Mot de passe de gestion de stock requis');
    }
    await this.stockPasswordService.verifyPassword(merchant.organization_id, stockPassword);
  }

  /**
   * The patron's shared stock password, for the operations that don't carry it
   * in their body (add an item, record a movement, validate an inventory): sent
   * in the `x-stock-password` header. Missing → 403 STOCK_PASSWORD_REQUIRED and
   * the app asks for it; wrong → 403 STOCK_PASSWORD_INVALID with the reason
   * (remaining tries, lock-out). Administrators are not asked.
   */
  async assertManagementPassword(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    password: string | undefined,
  ) {
    const merchant = await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);
    if (this.isAdmin(callerRole)) return;
    if (!merchant.organization_id) {
      throw new BadRequestException("Cette boutique ne fait partie d'aucune entreprise");
    }
    if (!password) {
      throw new ForbiddenException({ statusCode: 403, code: 'STOCK_PASSWORD_REQUIRED', message: 'Mot de passe de gestion de stock requis' });
    }
    try {
      await this.stockPasswordService.verifyPassword(merchant.organization_id, password);
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw new ForbiddenException({ statusCode: 403, code: 'STOCK_PASSWORD_INVALID', message: err.message });
      }
      throw err;
    }
  }

  async updateItem(
    merchantId: string,
    itemId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    updates: Record<string, any>,
    stockPassword: string | undefined,
  ) {
    const merchant = await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);
    await this.assertStockPassword(merchant, stockPassword);

    // quantity is not written directly. When the product sheet sends a new
    // quantity, the difference is recorded as an 'adjustment' movement via
    // createMovement() below, so stock_movements stays the single source of
    // truth (enforced in the DB by the trg_apply_stock_movement trigger from
    // migration 031).
    const allowedFields = [
      'name', 'category', 'item_type', 'attributes', 'image_url', 'description',
      'barcode', 'brand', 'model', 'serial_number', 'condition', 'warranty_months',
      'unit_price_cents', 'cost_price_cents', 'currency', 'low_stock_threshold',
    ];
    const filtered: Record<string, any> = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) filtered[key] = updates[key];
    }
    // An emptied barcode field means "no code" — stored as NULL, never '',
    // or two code-less products would collide on the (merchant, barcode)
    // unique constraint.
    if (filtered.barcode !== undefined) filtered.barcode = String(filtered.barcode).trim() || null;

    const { data: current, error: currentError } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('*')
      .eq('id', itemId)
      .eq('merchant_id', merchantId)
      .single();

    if (currentError || !current) throw new NotFoundException('Stock item not found');

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .update(filtered)
      .eq('id', itemId)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error) {
      this.throwIfDuplicate(error);
      throw new Error(`Failed to update stock item: ${error.message}`);
    }

    // Who changed what: kept in the audit journal (the shared password says
    // nothing about the person, their own login does).
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(filtered)) {
      if (JSON.stringify(current[key]) !== JSON.stringify(filtered[key])) changes[key] = { from: current[key], to: filtered[key] };
    }
    if (Object.keys(changes).length > 0) {
      await this.auditService.log({
        user_id: callerId,
        action: 'stock_item_updated',
        entity_type: 'stock_item',
        entity_id: itemId,
        changes: { name: current.name, merchant_id: merchantId, fields: changes },
      });
    }

    const newQuantity = updates.quantity;
    if (typeof newQuantity === 'number' && newQuantity !== current.quantity) {
      await this.createMovement(merchantId, itemId, callerId, callerRole, callerOrgId, {
        type: 'adjustment',
        quantity_delta: newQuantity - current.quantity,
        reason: 'Modifiée depuis la fiche produit',
      });
      return { ...data, quantity: newQuantity };
    }

    return data;
  }

  async deleteItem(
    merchantId: string,
    itemId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    stockPassword: string | undefined,
  ) {
    const merchant = await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);
    await this.assertStockPassword(merchant, stockPassword);

    const { data: before } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('name, barcode, quantity, unit_price_cents, cost_price_cents, currency')
      .eq('id', itemId)
      .eq('merchant_id', merchantId)
      .maybeSingle();

    const { error } = await this.supabaseService.getClient()
      .from('stock_items')
      .delete()
      .eq('id', itemId)
      .eq('merchant_id', merchantId);

    if (error) throw new Error(`Failed to delete stock item: ${error.message}`);

    // A deleted article leaves no row behind, so what it was and who removed it is recorded here.
    await this.auditService.log({
      user_id: callerId,
      action: 'stock_item_deleted',
      entity_type: 'stock_item',
      entity_id: itemId,
      changes: { merchant_id: merchantId, item: before || null },
    });
    return { success: true };
  }

  /** Uploads a product image to the public 'product-images' bucket (see
   * migration 033) and returns its URL — mirrors
   * OrganizationsService.ensureScanLinkPayQr's upload shape, just for a
   * user-supplied file instead of a server-generated one. Called before
   * create/update, not as part of them, so the frontend can preview the
   * image immediately and retry the upload independently of the rest of
   * the form. */
  async uploadItemImage(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    file: Express.Multer.File | undefined,
  ) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    if (!file) {
      throw new BadRequestException('Aucun fichier reçu');
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Format d\'image non supporté (JPEG, PNG ou WebP uniquement)');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('L\'image ne doit pas dépasser 2 Mo');
    }

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${merchantId}/${randomUUID()}.${ext}`;

    const { error: uploadError } = await this.supabaseService.getClient()
      .storage
      .from('product-images')
      .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      throw new Error(`Failed to upload product image: ${uploadError.message}`);
    }

    const { data: urlData } = this.supabaseService.getClient().storage.from('product-images').getPublicUrl(fileName);
    return { url: urlData.publicUrl };
  }

  /** Records a restock ('in'), a loss/breakage/manual removal ('out') or a
   * correction ('adjustment') — the DB trigger applies quantity_delta to
   * stock_items.quantity atomically. If the resulting quantity drops to or
   * below the item's low_stock_threshold, the organization's owner is
   * notified (best-effort — never blocks the movement itself). */
  async createMovement(
    merchantId: string,
    itemId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { type: 'in' | 'out' | 'adjustment' | 'sale'; quantity_delta: number; reason?: string },
  ) {
    // A 'sale' movement is how the POS till deducts stock — caissier/vendeur
    // need it (POS_SALE_ROLES), while manual 'in'/'out'/'adjustment' still
    // require the full magasinier access.
    const merchant = await this.resolveMerchantAccess(
      merchantId, callerId, callerRole, callerOrgId,
      data.type === 'sale' ? POS_SALE_ROLES : STOCK_STAFF_ROLES,
    );

    const { data: currentItem, error: itemError } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('quantity')
      .eq('id', itemId)
      .eq('merchant_id', merchantId)
      .single();

    if (itemError || !currentItem) throw new NotFoundException('Stock item not found');
    if (currentItem.quantity + data.quantity_delta < 0) {
      throw new BadRequestException(
        `Quantité insuffisante : il ne reste que ${currentItem.quantity} unité(s) en stock`,
      );
    }

    const { data: movement, error } = await this.supabaseService.getClient()
      .from('stock_movements')
      .insert({
        stock_item_id: itemId,
        merchant_id: merchantId,
        type: data.type,
        quantity_delta: data.quantity_delta,
        reason: data.reason || null,
        created_by: callerId,
      })
      .select()
      .single();

    if (error) {
      // 23514 = check_violation: stock_items_quantity_nonnegative refused it —
      // another sale took the last units between the check above and here.
      if (error.code === '23514') {
        throw new BadRequestException('Quantité insuffisante : le stock vient de changer');
      }
      throw new Error(`Failed to record stock movement: ${error.message}`);
    }

    const { data: item } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('name, quantity, low_stock_threshold')
      .eq('id', itemId)
      .single();

    if (item && merchant.organization_id && item.quantity <= item.low_stock_threshold) {
      const organization = await this.organizationsService.getOrganizationById(merchant.organization_id).catch(() => null);
      if (organization) {
        await this.notificationsService.create({
          user_id: organization.owner_id,
          type: 'stock_low',
          title: 'Stock bas',
          body: `${item.name} (${merchant.name}) — il ne reste que ${item.quantity} unité(s).`,
          data: { merchant_id: merchantId, stock_item_id: itemId },
        });
      }
    }

    return movement;
  }

  /** POS barcode scan lookup — read-level access, caissier included
   * (POS_SALE_ROLES, narrower than full stock-management access). */
  async getItemByBarcode(merchantId: string, barcode: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, POS_SALE_ROLES);

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('id, name, category, barcode, unit_price_cents, currency, quantity')
      .eq('merchant_id', merchantId)
      .eq('barcode', barcode)
      .maybeSingle();

    if (error) throw new Error(`Failed to look up stock item: ${error.message}`);
    if (!data) throw new NotFoundException('Aucun produit avec ce code-barres dans cette boutique');
    return data;
  }

  /** POS product search (by name) — same POS_SALE_ROLES access as
   * getItemByBarcode(), and deliberately selects only the fields a cashier
   * needs to sell (never cost_price_cents — that reveals margin and stays
   * magasinier/owner-only via the full listItems()). */
  async searchSellableItems(merchantId: string, query: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, POS_SALE_ROLES);

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('id, name, category, barcode, unit_price_cents, currency, quantity')
      .eq('merchant_id', merchantId)
      // Strip the chars that are meaningful inside a PostgREST ilike value
      // so a cashier typing "%" or "," doesn't break the till's search.
      .ilike('name', `%${query.replace(/[%_,"'()\\]/g, '')}%`)
      .order('name', { ascending: true })
      .limit(20);

    if (error) throw new Error(`Failed to search stock items: ${error.message}`);
    return data || [];
  }

  async listMovements(merchantId: string, itemId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    // The movement history (restocks, losses, who did what) is for the patron and the stock keeper, not the sellers.
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_movements')
      .select('*')
      .eq('stock_item_id', itemId)
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch stock movements: ${error.message}`);
    return data || [];
  }

  /** Aggregated stock across every store the organization owns — the "sees
   * everything" admin view. Same fan-out shape as
   * OrganizationsService.getOrganizationStoresBreakdown(): fetch the org's
   * stores first, then query stock_items with merchant_id IN (...). */
  async getOrgStockItems(orgId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    this.assertOrgAccess(org, callerId, callerRole, callerOrgId, true);

    const merchants = await this.organizationsService.getOrganizationMerchants(orgId);
    const merchantIds = merchants.map((m) => m.id);
    if (!merchantIds.length) return [];

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('*')
      .in('merchant_id', merchantIds)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch organization stock: ${error.message}`);

    const merchantNameById: Record<string, string> = {};
    merchants.forEach((m) => { merchantNameById[m.id] = m.name; });

    return (data || []).map((item) => this.redactForRole({ ...item, merchant_name: merchantNameById[item.merchant_id] || null }, callerRole));
  }

  async getOrgStockSummary(orgId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const items = await this.getOrgStockItems(orgId, callerId, callerRole, callerOrgId);

    const valueRows = items.map((i) => ({ amount_cents: i.quantity * i.unit_price_cents, currency: i.currency }));

    return {
      total_items: items.length,
      total_units: items.reduce((sum, i) => sum + i.quantity, 0),
      low_stock_count: items.filter((i) => i.quantity <= i.low_stock_threshold).length,
      // Independent per-currency figures — never summed together.
      stock_value: sumByCurrency(valueRows, 'amount_cents'),
    };
  }
}
