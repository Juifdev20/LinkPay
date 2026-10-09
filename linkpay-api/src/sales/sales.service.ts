import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { StockPasswordService } from '../stock/stock-password.service';
import { AuditService } from '../audit/audit.service';

// Internal staff roles (organization-staff module) per sales action. The
// owner is always allowed on top of these — see assertOrgAccess().
const SELLER_ROLES = ['vendeur', 'caissier'] as const;
const SALES_VIEW_ROLES = ['vendeur', 'caissier', 'comptable'] as const;
// Hiding a sale from the history is a finance decision (and a fraud vector: ring up, take cash, hide): owner and accountant only.
const SALES_ARCHIVE_ROLES = ['comptable'] as const;
// What the shop paid for an item (and so its margin) is for the owner and the finance role only: a seller or a
// cashier sees prices and quantities. Stripped here, on the server — hiding it in the screen would not protect it.
const COST_BLIND_ROLES = ['vendeur', 'caissier'];
const withoutCost = <T extends Record<string, any>>(items: T[] | undefined, role?: string): T[] =>
  (items || []).map((item) => {
    if (!role || !COST_BLIND_ROLES.includes(role)) return item;
    const { unit_cost_cents: _cost, ...rest } = item;
    return rest as T;
  });

export interface SaleLineInput {
  stock_item_id: string;
  quantity: number;
}

type Money = Record<string, number>;

function addTo(map: Money, currency: string, amount: number) {
  map[currency] = (map[currency] || 0) + amount;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private supabaseService: SupabaseService,
    private stockPasswordService: StockPasswordService,
    private auditService: AuditService,
  ) {}

  private db() {
    return this.supabaseService.getClient();
  }

  /** Owner always has access. Internal staff only if their role is in
   * `allowedRoles` AND they belong to this organization (JWT organization_id). */
  private async assertOrgAccess(
    orgId: string,
    callerId: string,
    callerOrgId: string | undefined,
    callerRole: string | undefined,
    allowedRoles: readonly string[],
  ) {
    const { data: org, error } = await this.db().from('organizations').select('id, owner_id').eq('id', orgId).single();
    if (error || !org) throw new NotFoundException('Organization not found');
    const isOwner = org.owner_id === callerId;
    const isAllowedStaff = callerOrgId === orgId && !!callerRole && allowedRoles.includes(callerRole);
    if (!isOwner && !isAllowedStaff) {
      throw new ForbiddenException("Vous n'avez pas accès aux ventes de cette entreprise");
    }
    return org;
  }

  private async getOrgMerchant(orgId: string) {
    const { data, error } = await this.db()
      .from('merchants')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw new BadRequestException("Aucune boutique n'est liée à cette entreprise");
    return data;
  }

  async createSale(orgId: string, callerId: string, callerOrgId: string | undefined, lines: SaleLineInput[], callerRole?: string) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('Le panier est vide');
    }
    for (const line of lines) {
      if (!line?.stock_item_id || !Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new BadRequestException('Ligne de panier invalide');
      }
    }

    const merchant = await this.getOrgMerchant(orgId);
    const ids = lines.map((l) => l.stock_item_id);
    const { data: items, error: itemsError } = await this.db()
      .from('stock_items')
      .select('id, name, category, brand, model, condition, serial_number, warranty_months, attributes, quantity, unit_price_cents, cost_price_cents, currency, merchant_id')
      .in('id', ids);
    if (itemsError) throw new Error(`Failed to load stock items: ${itemsError.message}`);

    const byId = new Map((items || []).map((i) => [i.id, i]));
    // Total wanted per article: the same article may appear on several lines,
    // and each line passing the stock check on its own would oversell it.
    const wantedByItem = new Map<string, number>();
    for (const line of lines) {
      wantedByItem.set(line.stock_item_id, (wantedByItem.get(line.stock_item_id) ?? 0) + line.quantity);
    }
    let currency: string | null = null;
    let total = 0;
    const snapshot = lines.map((line) => {
      const item = byId.get(line.stock_item_id);
      if (!item || item.merchant_id !== merchant.id) {
        throw new BadRequestException('Un article du panier n\'appartient pas à cette entreprise');
      }
      if ((wantedByItem.get(item.id) ?? line.quantity) > item.quantity) {
        throw new BadRequestException(`Stock insuffisant pour "${item.name}" : il reste ${item.quantity} unité(s)`);
      }
      if (currency && currency !== item.currency) {
        throw new BadRequestException('Une vente ne peut contenir que des articles dans la même devise');
      }
      currency = item.currency;
      total += item.unit_price_cents * line.quantity;
      return {
        stock_item_id: item.id,
        name: item.name,
        category: item.category,
        quantity: line.quantity,
        unit_price_cents: item.unit_price_cents,
        unit_cost_cents: item.cost_price_cents ?? 0,
        currency: item.currency,
        // Product sheet frozen at sale time, for the invoice and traceability
        // (a later edit or deletion of the stock item must not change it).
        details: {
          brand: item.brand ?? null,
          model: item.model ?? null,
          condition: item.condition ?? null,
          serial_number: item.serial_number ?? null,
          warranty_months: item.warranty_months ?? null,
          attributes: item.attributes ?? {},
        },
      };
    });

    const reference = `SALE-${randomBytes(6).toString('hex').toUpperCase()}`;
    const description = snapshot.map((s) => `${s.quantity} x ${s.name}`).join(', ');

    const { data: request, error: requestError } = await this.db()
      .from('payment_requests')
      .insert({
        merchant_id: merchant.id,
        amount_cents: total,
        currency: currency || 'CDF',
        reference: `REQ-${reference}`,
        description: `Vente ${reference} — ${description}`,
        link_token: randomBytes(32).toString('hex'),
        status: 'CREATED',
      })
      .select('id, link_token')
      .single();
    if (requestError || !request) throw new Error(`Failed to create payment request: ${requestError?.message}`);

    const { data: sale, error: saleError } = await this.db()
      .from('sales')
      .insert({
        organization_id: orgId,
        merchant_id: merchant.id,
        reference,
        status: 'PENDING',
        payment_method: 'wallet',
        currency: currency || 'CDF',
        total_cents: total,
        payment_request_id: request.id,
        created_by: callerId,
      })
      .select()
      .single();
    if (saleError || !sale) throw new Error(`Failed to create sale: ${saleError?.message}`);

    const { error: linesError } = await this.db()
      .from('sale_items')
      .insert(snapshot.map((s) => ({ ...s, sale_id: sale.id })));
    if (linesError) throw new Error(`Failed to create sale items: ${linesError.message}`);

    return { sale, link_token: request.link_token, items: withoutCost(snapshot as any[], callerRole) };
  }

  async getSale(orgId: string, saleId: string, callerId: string, callerOrgId: string | undefined, callerRole?: string) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);
    const { data: sale, error } = await this.db()
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', saleId)
      .eq('organization_id', orgId)
      .single();
    if (error || !sale) throw new NotFoundException('Vente introuvable');

    let link_token: string | null = null;
    if (sale.payment_request_id) {
      const { data: request } = await this.db()
        .from('payment_requests')
        .select('link_token')
        .eq('id', sale.payment_request_id)
        .single();
      link_token = request?.link_token ?? null;
    }
    return { ...sale, sale_items: withoutCost(sale.sale_items as any[], callerRole), link_token };
  }

  /** Records stock leaving the shelf for a paid sale. Writes stock_movements
   * directly (the DB trigger from migration 031 applies quantity_delta), so
   * this runs from the payment pipeline without a user session. */
  private async releaseStock(sale: { id: string; reference: string; merchant_id: string; created_by: string | null }) {
    const { data: items, error } = await this.db()
      .from('sale_items')
      .select('stock_item_id, quantity')
      .eq('sale_id', sale.id);
    if (error) throw new Error(`Failed to load sale items: ${error.message}`);

    for (const item of items || []) {
      if (!item.stock_item_id) continue;
      const { error: movementError } = await this.db().from('stock_movements').insert({
        stock_item_id: item.stock_item_id,
        merchant_id: sale.merchant_id,
        type: 'out',
        quantity_delta: -item.quantity,
        reason: `Vente ${sale.reference}`,
        created_by: sale.created_by,
      });
      if (movementError) throw new Error(`Failed to record stock movement: ${movementError.message}`);
    }
  }

  /** Called by PaymentsService once a wallet payment on the sale's payment
   * request has succeeded. Idempotent: a sale already PAID is left alone. */
  async markPaidByPaymentRequest(paymentRequestId: string, transactionId: string | undefined) {
    const { data: sale } = await this.db()
      .from('sales')
      .select('id, reference, merchant_id, created_by, status')
      .eq('payment_request_id', paymentRequestId)
      .maybeSingle();
    if (!sale || sale.status !== 'PENDING') return;

    const { error } = await this.db()
      .from('sales')
      .update({ status: 'PAID', payment_method: 'wallet', paid_at: new Date().toISOString(), transaction_id: transactionId ?? null })
      .eq('id', sale.id)
      .eq('status', 'PENDING');
    if (error) throw new Error(`Failed to mark sale paid: ${error.message}`);

    await this.releaseStock(sale);
  }

  async payCash(orgId: string, saleId: string, callerId: string, callerOrgId: string | undefined, callerRole?: string) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);
    const { data: sale, error } = await this.db()
      .from('sales')
      .select('id, reference, merchant_id, created_by, status, payment_request_id')
      .eq('id', saleId)
      .eq('organization_id', orgId)
      .single();
    if (error || !sale) throw new NotFoundException('Vente introuvable');
    if (sale.status !== 'PENDING') throw new BadRequestException('Cette vente a déjà été traitée');

    const { data: updated, error: updateError } = await this.db()
      .from('sales')
      .update({ status: 'PAID', payment_method: 'cash', paid_at: new Date().toISOString() })
      .eq('id', sale.id)
      .eq('status', 'PENDING')
      .select()
      .maybeSingle();
    if (updateError || !updated) throw new BadRequestException('Cette vente a déjà été traitée');

    // Close the payment request so the same QR can't be paid later by wallet.
    if (sale.payment_request_id) {
      await this.db()
        .from('payment_requests')
        .update({ status: 'CANCELLED' })
        .eq('id', sale.payment_request_id)
        .eq('status', 'CREATED');
    }

    await this.releaseStock(sale);
    return updated;
  }

  /** Financial dashboard numbers for paid sales in [from, to). Money is always
   * kept per currency — CDF and USD are never summed together. Net margin
   * deducts the platform/PSP fees recorded on the linked wallet transaction. */
  async getStats(orgId: string, callerId: string, callerOrgId: string | undefined, from?: string, to?: string, callerRole?: string) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);

    let query = this.db()
      .from('sales')
      .select('id, currency, total_cents, paid_at, transaction_id, sale_items(name, category, stock_item_id, quantity, unit_price_cents, unit_cost_cents)')
      .eq('organization_id', orgId)
      .eq('status', 'PAID');
    if (from) query = query.gte('paid_at', from);
    if (to) query = query.lt('paid_at', to);
    const { data: sales, error } = await query;
    if (error) throw new Error(`Failed to load sales stats: ${error.message}`);

    const txIds = (sales || []).map((s) => s.transaction_id).filter(Boolean) as string[];
    const feesByTx = new Map<string, number>();
    if (txIds.length) {
      const { data: txs } = await this.db()
        .from('transactions')
        .select('id, psp_fee_cents, platform_fee_cents, other_fees_cents')
        .in('id', txIds);
      for (const tx of txs || []) {
        feesByTx.set(tx.id, (tx.psp_fee_cents || 0) + (tx.platform_fee_cents || 0) + (tx.other_fees_cents || 0));
      }
    }

    const revenue: Money = {};
    const cost: Money = {};
    const fees: Money = {};
    const products = new Map<string, { name: string; category: string | null; quantity: number; revenue: Money; margin: Money }>();
    const categories = new Map<string, { revenue: Money; margin: Money; quantity: number }>();
    const daily = new Map<string, Money>();

    for (const sale of sales || []) {
      const cur = sale.currency;
      const day = (sale.paid_at || '').slice(0, 10);
      if (sale.transaction_id && feesByTx.has(sale.transaction_id)) {
        addTo(fees, cur, feesByTx.get(sale.transaction_id)!);
      }
      for (const line of (sale.sale_items as any[]) || []) {
        const lineRevenue = line.unit_price_cents * line.quantity;
        const lineCost = line.unit_cost_cents * line.quantity;
        const lineMargin = lineRevenue - lineCost;
        addTo(revenue, cur, lineRevenue);
        addTo(cost, cur, lineCost);
        if (day) {
          const d = daily.get(day) || {};
          addTo(d, cur, lineRevenue);
          daily.set(day, d);
        }

        const pKey = line.stock_item_id || line.name;
        const p = products.get(pKey) || { name: line.name, category: line.category, quantity: 0, revenue: {}, margin: {} };
        p.quantity += line.quantity;
        addTo(p.revenue, cur, lineRevenue);
        addTo(p.margin, cur, lineMargin);
        products.set(pKey, p);

        const cKey = line.category || 'sans_categorie';
        const c = categories.get(cKey) || { revenue: {}, margin: {}, quantity: 0 };
        c.quantity += line.quantity;
        addTo(c.revenue, cur, lineRevenue);
        addTo(c.margin, cur, lineMargin);
        categories.set(cKey, c);
      }
    }

    const grossMargin: Money = {};
    const netMargin: Money = {};
    for (const cur of new Set([...Object.keys(revenue), ...Object.keys(cost)])) {
      grossMargin[cur] = (revenue[cur] || 0) - (cost[cur] || 0);
      netMargin[cur] = grossMargin[cur] - (fees[cur] || 0);
    }

    const topProducts = [...products.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
    const byCategory = [...categories.entries()].map(([category, v]) => ({ category, ...v }));
    const daysSeries = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amounts]) => ({ day, ...amounts }));

    // Sellers see sales volume only — cost, margins and platform fees are
    // reserved for the owner and the finance role (stripped server-side, not
    // just hidden in the UI).
    if (callerRole && COST_BLIND_ROLES.includes(callerRole)) {
      return {
        sales_count: (sales || []).length,
        revenue,
        top_products: topProducts.map(({ margin, cost: _cost, ...p }: any) => p),
        by_category: byCategory.map(({ margin, cost: _cost, ...c }: any) => c),
        daily: daysSeries,
      };
    }

    return {
      sales_count: (sales || []).length,
      revenue,
      cost,
      gross_margin: grossMargin,
      fees,
      net_margin: netMargin,
      top_products: topProducts,
      by_category: byCategory,
      daily: daysSeries,
    };
  }

  /** Sales history list: every sale not archived, newest first, with the
   * exact timestamp so the screen can show the time of day. Archived sales
   * (history_hidden_at set) are excluded from the list only — stats and
   * accounting still read them. */
  async getHistory(
    orgId: string,
    callerId: string,
    callerOrgId: string | undefined,
    callerRole: string | undefined,
    from?: string,
    to?: string,
  ) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);

    let query = this.db()
      .from('sales')
      .select('id, reference, status, payment_method, currency, total_cents, paid_at, created_at, sale_items(name, quantity)')
      .eq('organization_id', orgId)
      .is('history_hidden_at', null)
      .order('created_at', { ascending: false })
      .limit(500);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lt('created_at', to);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to load sales history: ${error.message}`);

    return (data || []).map((sale: any) => ({
      id: sale.id,
      reference: sale.reference,
      status: sale.status,
      payment_method: sale.payment_method,
      currency: sale.currency,
      total_cents: sale.total_cents,
      paid_at: sale.paid_at,
      created_at: sale.created_at,
      items_count: (sale.sale_items || []).reduce((n: number, l: any) => n + (l.quantity || 0), 0),
      items_preview: (sale.sale_items || []).map((l: any) => `${l.quantity} × ${l.name}`).join(', '),
    }));
  }

  /** Archives a sale from the history list. Requires the organization's stock
   * management password (same gate as stock edits); never deletes the sale. */
  async archiveSale(
    orgId: string,
    saleId: string,
    callerId: string,
    callerOrgId: string | undefined,
    callerRole: string | undefined,
    managementPassword: string,
  ) {
    await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_ARCHIVE_ROLES);
    await this.stockPasswordService.verifyPassword(orgId, managementPassword);

    const { data, error } = await this.db()
      .from('sales')
      .update({ history_hidden_at: new Date().toISOString() })
      .eq('id', saleId)
      .eq('organization_id', orgId)
      .is('history_hidden_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Failed to archive sale: ${error.message}`);
    if (!data) throw new NotFoundException('Vente introuvable ou déjà archivée');
    await this.auditService.log({
      user_id: callerId,
      action: 'sale_archived',
      entity_type: 'sale',
      entity_id: saleId,
      changes: { organization_id: orgId },
    });
    return { success: true };
  }
}
