import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sumByCurrency } from '../common/utils/currency';

// Only 'magasinier' can manage stock today — the other enterprise-staff
// roles (vendeur/caissier/comptable) get their own gate once their modules
// (ventes, caisse) land, same reasoning as elsewhere in this codebase of
// only building the access path a real feature needs right now.
const STOCK_STAFF_ROLES = ['magasinier'];

@Injectable()
export class StockService {
  constructor(
    private supabaseService: SupabaseService,
    private organizationsService: OrganizationsService,
    private notificationsService: NotificationsService,
  ) {}

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  /** A store's stock can be managed by whoever owns the store (a plain
   * merchant owner, or the enterprise owner — createMerchant() always sets
   * merchants.owner_id to the enterprise owner even for org-created stores,
   * so this single check covers both), an org-scoped 'magasinier' of the
   * SAME organization the store belongs to (via the JWT's organization_id —
   * see auth.service.ts), or a platform admin. */
  private async resolveMerchantAccess(
    merchantId: string,
    callerId: string | undefined,
    callerRole: string | undefined,
    callerOrgId: string | undefined,
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
    if (callerOrgId && merchant.organization_id === callerOrgId && STOCK_STAFF_ROLES.includes(callerRole || '')) {
      return merchant;
    }

    throw new ForbiddenException('You do not manage this store\'s stock');
  }

  private assertOrgAccess(org: any, callerId: string | undefined, callerRole: string | undefined, callerOrgId: string | undefined) {
    if (this.isAdmin(callerRole)) return;
    if (callerId && org.owner_id === callerId) return;
    if (callerOrgId && org.id === callerOrgId && STOCK_STAFF_ROLES.includes(callerRole || '')) return;
    throw new ForbiddenException('You do not manage this organization\'s stock');
  }

  async createItem(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: {
      name: string;
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
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        throw new BadRequestException('Un article avec ce numéro de série existe déjà');
      }
      throw new Error(`Failed to create stock item: ${error.message}`);
    }
    return item;
  }

  async listItems(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch stock items: ${error.message}`);
    return data || [];
  }

  async updateItem(
    merchantId: string,
    itemId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    updates: Record<string, any>,
  ) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    // quantity is deliberately not in this list — it only ever changes
    // through createMovement() below, which keeps stock_movements as the
    // single source of truth (enforced in the DB by the
    // trg_apply_stock_movement trigger from migration 031).
    const allowedFields = [
      'name', 'brand', 'model', 'serial_number', 'condition', 'warranty_months',
      'unit_price_cents', 'cost_price_cents', 'currency', 'low_stock_threshold',
    ];
    const filtered: Record<string, any> = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) filtered[key] = updates[key];
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('stock_items')
      .update(filtered)
      .eq('id', itemId)
      .eq('merchant_id', merchantId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update stock item: ${error.message}`);
    return data;
  }

  async deleteItem(merchantId: string, itemId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

    const { error } = await this.supabaseService.getClient()
      .from('stock_items')
      .delete()
      .eq('id', itemId)
      .eq('merchant_id', merchantId);

    if (error) throw new Error(`Failed to delete stock item: ${error.message}`);
    return { success: true };
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
    data: { type: 'in' | 'out' | 'adjustment'; quantity_delta: number; reason?: string },
  ) {
    const merchant = await this.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);

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

    if (error) throw new Error(`Failed to record stock movement: ${error.message}`);

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

  async listMovements(merchantId: string, itemId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
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
    this.assertOrgAccess(org, callerId, callerRole, callerOrgId);

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

    return (data || []).map((item) => ({ ...item, merchant_name: merchantNameById[item.merchant_id] || null }));
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
