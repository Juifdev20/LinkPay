import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';

/**
 * Physical stock takes (spec 1.4): a count snapshots every in-scope
 * product's theoretical quantity at start (expected_qty), staff then enter
 * the physically counted quantities WITHOUT stopping sales — at
 * validation the adjustment applied is counted − CURRENT stock (so a sale
 * that happened mid-count isn't double-deducted), while the shrinkage
 * report ("rapport de démarque") compares counted − expected.
 *
 * Uncounted lines are skipped on completion: forgetting to count a shelf
 * must never silently zero its stock.
 */
@Injectable()
export class InventoryService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async assertAccess(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    return this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId);
  }

  private async getOwnCount(merchantId: string, countId: string) {
    const { data, error } = await this.db
      .from('inventory_counts')
      .select('*')
      .eq('id', countId)
      .eq('merchant_id', merchantId)
      .single();
    if (error || !data) throw new NotFoundException('Inventaire introuvable');
    return data;
  }

  private async getLines(countId: string) {
    const { data } = await this.db
      .from('inventory_count_lines')
      .select('*')
      .eq('count_id', countId)
      .order('product_name_snapshot', { ascending: true });
    return data || [];
  }

  /** Detail + démarque report: variances and their value at sale price,
   * split per currency (the store can carry both CDF and USD items). */
  private async withReport(count: any) {
    const lines = await this.getLines(count.id);
    const counted = lines.filter((l) => l.counted_qty !== null);
    const varianceLines = counted.filter((l) => l.variance !== null ? l.variance !== 0 : l.counted_qty !== l.expected_qty);

    const lossByCurrency: Record<string, number> = {};
    const gainByCurrency: Record<string, number> = {};
    for (const l of varianceLines) {
      const v = l.variance !== null ? l.variance : l.counted_qty - l.expected_qty;
      const bucket = v < 0 ? lossByCurrency : gainByCurrency;
      bucket[l.currency] = (bucket[l.currency] || 0) + Math.abs(v) * l.unit_price_cents_snapshot;
    }

    return {
      ...count,
      lines,
      report: {
        total_lines: lines.length,
        counted_lines: counted.length,
        uncounted_lines: lines.length - counted.length,
        variance_lines: varianceLines.length,
        loss_cents_by_currency: lossByCurrency,
        gain_cents_by_currency: gainByCurrency,
      },
    };
  }

  async createCount(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { scope_category?: string; notes?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data: inProgress } = await this.db
      .from('inventory_counts')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('status', 'counting')
      .maybeSingle();
    if (inProgress) {
      throw new BadRequestException('Un inventaire est déjà en cours pour cette boutique — terminez-le ou annulez-le d\'abord.');
    }

    let itemsQuery = this.db
      .from('stock_items')
      .select('id, name, category, unit_price_cents, currency, quantity')
      .eq('merchant_id', merchantId)
      .order('name');
    if (data.scope_category) itemsQuery = itemsQuery.eq('category', data.scope_category);
    const { data: items } = await itemsQuery;

    if (!items?.length) {
      throw new BadRequestException('Aucun produit dans ce périmètre.');
    }

    const { data: count, error } = await this.db
      .from('inventory_counts')
      .insert({
        merchant_id: merchantId,
        scope_category: data.scope_category || null,
        notes: data.notes || null,
        created_by: callerId,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create inventory count: ${error.message}`);

    const { error: linesError } = await this.db.from('inventory_count_lines').insert(
      items.map((item) => ({
        count_id: count.id,
        stock_item_id: item.id,
        product_name_snapshot: item.name,
        category_snapshot: item.category || null,
        unit_price_cents_snapshot: item.unit_price_cents,
        currency: item.currency,
        expected_qty: item.quantity,
      })),
    );
    if (linesError) throw new Error(`Failed to snapshot inventory lines: ${linesError.message}`);

    await this.auditService.log({
      user_id: callerId,
      action: 'inventory_started',
      entity_type: 'inventory_count',
      entity_id: count.id,
      changes: { scope_category: data.scope_category || 'total', lines: items.length },
    });

    return this.withReport(count);
  }

  async listCounts(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { status?: string; page?: number; limit?: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    let query = this.db
      .from('inventory_counts')
      .select('*, lines:inventory_count_lines(count)', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', filters.status);

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list inventory counts: ${error.message}`);
    return { data: data || [], total: count || 0, page, limit };
  }

  async getCount(merchantId: string, countId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    return this.withReport(await this.getOwnCount(merchantId, countId));
  }

  /** Bulk-save counted quantities — partial saves are expected (the staff
   * counts aisle by aisle and saves progress). */
  async saveLines(
    merchantId: string,
    countId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    lines: { line_id: string; counted_qty: number }[],
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const count = await this.getOwnCount(merchantId, countId);
    if (count.status !== 'counting') throw new BadRequestException('Cet inventaire est clôturé.');

    await Promise.all(
      lines.map((l) =>
        this.db
          .from('inventory_count_lines')
          .update({ counted_qty: l.counted_qty, counted_at: new Date().toISOString() })
          .eq('id', l.line_id)
          .eq('count_id', countId),
      ),
    );

    return this.withReport(count);
  }

  /** Validation: for every counted line, variance = counted − expected goes
   * into the démarque report, and the stock is realigned by counted −
   * CURRENT quantity via an 'adjustment' movement (mid-count sales were
   * already deducted by the POS, so expected-at-start isn't the base). */
  async complete(merchantId: string, countId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const count = await this.getOwnCount(merchantId, countId);
    if (count.status !== 'counting') throw new BadRequestException('Cet inventaire est clôturé.');

    const lines = await this.getLines(countId);
    const counted = lines.filter((l) => l.counted_qty !== null);
    if (!counted.length) {
      throw new BadRequestException('Aucune ligne comptée — saisissez au moins un comptage avant de valider.');
    }

    let adjusted = 0;
    for (const line of counted) {
      const variance = line.counted_qty - line.expected_qty;
      await this.db.from('inventory_count_lines').update({ variance }).eq('id', line.id);

      const { data: item } = await this.db
        .from('stock_items')
        .select('quantity')
        .eq('id', line.stock_item_id)
        .single();
      if (!item) continue;

      const delta = line.counted_qty - item.quantity;
      if (delta !== 0) {
        await this.stockService.createMovement(merchantId, line.stock_item_id, callerId, callerRole, callerOrgId, {
          type: 'adjustment',
          quantity_delta: delta,
          reason: `Inventaire ${count.scope_category ? `rayon « ${count.scope_category} »` : 'général'} — écart ${variance > 0 ? '+' : ''}${variance}`,
        });
        adjusted++;
      }
    }

    const { data: closed } = await this.db
      .from('inventory_counts')
      .update({ status: 'completed', completed_by: callerId, completed_at: new Date().toISOString() })
      .eq('id', countId)
      .eq('status', 'counting')
      .select()
      .single();

    await this.auditService.log({
      user_id: callerId,
      action: 'inventory_completed',
      entity_type: 'inventory_count',
      entity_id: countId,
      changes: { counted_lines: counted.length, adjusted_items: adjusted },
    });

    return this.withReport(closed);
  }

  async cancel(merchantId: string, countId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const count = await this.getOwnCount(merchantId, countId);
    if (count.status !== 'counting') throw new BadRequestException('Cet inventaire est déjà clôturé.');

    const { data } = await this.db
      .from('inventory_counts')
      .update({ status: 'cancelled' })
      .eq('id', countId)
      .select()
      .single();

    await this.auditService.log({
      user_id: callerId,
      action: 'inventory_cancelled',
      entity_type: 'inventory_count',
      entity_id: countId,
      changes: {},
    });

    return data;
  }
}
