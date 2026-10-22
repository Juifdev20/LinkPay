import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { StockPasswordService } from '../stock/stock-password.service';
import { AuditService } from '../audit/audit.service';
import { requireStaffStation } from '../common/org-access';

// Internal staff roles (organization-staff module) per sales action. The
// owner is always allowed on top of these — see assertOrgAccess().
const SELLER_ROLES = ['vendeur', 'caissier', 'gerant'] as const;
const SALES_VIEW_ROLES = ['vendeur', 'caissier', 'comptable', 'gerant'] as const;
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

  /** Owner always has access (every station: returns null). Internal staff
   * only if their role is in `allowedRoles` AND they belong to this
   * organization (JWT organization_id) — and then only to their station,
   * which is returned so every query can be narrowed to it. */
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
    if (isOwner) return null;
    return requireStaffStation(this.db(), callerId, orgId);
  }

  /** Narrows a sales query to a staff member's station (null = the owner, every station). */
  private inStation<Q extends { eq: (column: string, value: string) => Q }>(query: Q, station: string | null): Q {
    return station ? query.eq('merchant_id', station) : query;
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

  /**
   * The station an owner's sale belongs to. The owner sells from the catalog of every station, so it is the station
   * that holds the articles — one sale, one station (its stock and its cash); never simply the first station.
   */
  private async ownerSaleStation(orgId: string, itemIds: string[]) {
    const { data: items } = await this.db().from('stock_items').select('merchant_id').in('id', itemIds);
    const stations = [...new Set((items || []).map((i: any) => i.merchant_id))];
    if (stations.length > 1) {
      throw new BadRequestException('Une vente ne peut contenir que des articles d\'une même station.');
    }
    if (!stations.length) return this.getOrgMerchant(orgId);
    const { data: merchant } = await this.db()
      .from('merchants').select('id, name').eq('id', stations[0]).eq('organization_id', orgId).maybeSingle();
    if (!merchant) throw new BadRequestException('Un article du panier n\'appartient pas à cette entreprise');
    return merchant;
  }

  async createSale(orgId: string, callerId: string, callerOrgId: string | undefined, lines: SaleLineInput[], callerRole?: string) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);

    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('Le panier est vide');
    }
    for (const line of lines) {
      if (!line?.stock_item_id || !Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new BadRequestException('Ligne de panier invalide');
      }
    }

    const ids = lines.map((l) => l.stock_item_id);
    const merchant = station ? { id: station } : await this.ownerSaleStation(orgId, ids);
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

  /**
   * A sale made without network in the "Ventes" module, sent when the network came back (migration 075). Paid in
   * cash on the spot. record_offline_org_sale() writes sale, lines (product sheet frozen) and stock exit in one
   * transaction, once per client_ref; a price changed meanwhile or a stock already sold elsewhere comes back as
   * `conflicts` and goes to the journal, never refused.
   */
  async recordOfflineSale(
    orgId: string,
    callerId: string,
    callerOrgId: string | undefined,
    dto: { client_ref: string; sold_at: string; items: { stock_item_id: string; quantity: number; unit_price_cents: number }[] },
    callerRole?: string,
  ) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);
    const merchant = station ? { id: station } : await this.ownerSaleStation(orgId, dto.items.map((l) => l.stock_item_id));

    const lines = new Map<string, { stock_item_id: string; quantity: number; unit_price_cents: number }>();
    for (const l of dto.items) {
      const key = `${l.stock_item_id}:${l.unit_price_cents}`;
      const prev = lines.get(key);
      lines.set(key, prev ? { ...prev, quantity: prev.quantity + l.quantity } : { ...l });
    }

    const { data, error } = await this.db().rpc('record_offline_org_sale', {
      p_org_id: orgId,
      p_merchant_id: merchant.id,
      p_seller_id: callerId,
      p_client_ref: dto.client_ref,
      p_sold_at: dto.sold_at,
      p_items: [...lines.values()],
    });
    if (error || !data) {
      const m = error?.message ?? '';
      if (m.includes('SALE_OFFLINE_ITEM_NOT_FOUND')) throw new BadRequestException("Un article de cette vente n'existe plus dans la boutique (supprimé entre-temps).");
      if (m.includes('SALE_OFFLINE_MIXED_CURRENCY')) throw new BadRequestException('Une vente ne peut contenir que des articles dans la même devise.');
      if (m.includes('SALE_OFFLINE_')) throw new BadRequestException('Vente hors ligne invalide.');
      if (m.includes('record_offline_org_sale') && m.includes('does not exist')) this.logger.error('record_offline_org_sale() missing — run migration 075');
      throw new Error(`Failed to record offline sale: ${m}`);
    }

    const result = data as { sale_id: string; created: boolean; conflicts: any[] };
    if (result.created) {
      await this.auditService.log({
        user_id: callerId,
        action: result.conflicts?.length ? 'offline_sale_with_conflicts' : 'offline_sale_recorded',
        entity_type: 'sale',
        entity_id: result.sale_id,
        changes: { client_ref: dto.client_ref, sold_at: dto.sold_at, conflicts: result.conflicts ?? [] },
      });
    }
    const sale = await this.getSale(orgId, result.sale_id, callerId, callerOrgId, callerRole);
    return { ...sale, conflicts: result.conflicts ?? [], created: result.created };
  }

  async getSale(orgId: string, saleId: string, callerId: string, callerOrgId: string | undefined, callerRole?: string) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);
    const { data: sale, error } = await this.inStation(this.db()
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', saleId)
      .eq('organization_id', orgId), station)
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
      .select('stock_item_id, quantity, name')
      .eq('sale_id', sale.id);
    if (error) throw new Error(`Failed to load sale items: ${error.message}`);

    // The sale is paid: the money wins, as for offline sales (migration 075). An article already sold by another sale
    // meanwhile cannot go below zero (stock_items_quantity_nonnegative): what is missing is logged for the
    // inventory instead of failing a payment that already happened.
    for (const item of items || []) {
      if (!item.stock_item_id) continue;
      const { data: stock } = await this.db().from('stock_items').select('quantity').eq('id', item.stock_item_id).maybeSingle();
      const take = Math.min(item.quantity, Math.max(0, stock?.quantity ?? 0));
      if (take < item.quantity) {
        this.logger.error(`Sale ${sale.reference} paid but "${item.name}" short in stock: ${item.quantity} sold, ${take} left on the shelf — check the inventory`);
      }
      if (take <= 0) continue;
      const { error: movementError } = await this.db().from('stock_movements').insert({
        stock_item_id: item.stock_item_id,
        merchant_id: sale.merchant_id,
        type: 'out',
        quantity_delta: -take,
        reason: `Vente ${sale.reference}`,
        created_by: sale.created_by,
      });
      if (movementError) this.logger.error(`Sale ${sale.reference}: stock movement failed for ${item.stock_item_id}: ${movementError.message}`);
    }
  }

  /** Cash is only taken while every article of the sale is still on the shelf (another sale may have sold it). */
  private async assertStillInStock(saleId: string) {
    const { data: lines } = await this.db().from('sale_items').select('stock_item_id, quantity, name').eq('sale_id', saleId);
    const ids = (lines || []).map((l: any) => l.stock_item_id).filter(Boolean);
    if (!ids.length) return;
    const { data: stock } = await this.db().from('stock_items').select('id, quantity').in('id', ids);
    const left = new Map((stock || []).map((s: any) => [s.id, s.quantity]));
    for (const l of lines || []) {
      if (l.stock_item_id && (left.get(l.stock_item_id) ?? 0) < l.quantity) {
        throw new BadRequestException(`« ${l.name} » n'est plus en stock (vendu entre-temps) : annulez cette vente et refaites-la.`);
      }
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

  /**
   * The customer leaves without paying: the pending sale is cancelled and its payment QR closed, so nobody can pay
   * it later. Nothing to give back to the stock: a sale only takes its articles off the shelf once paid. Refused when
   * the client is paying by ScanLinkPay right now (the QR is already claimed).
   */
  async cancelSale(orgId: string, saleId: string, callerId: string, callerOrgId: string | undefined, callerRole?: string) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);
    const { data: sale, error } = await this.db()
      .from('sales')
      .select('id, status, payment_request_id, merchant_id')
      .eq('id', saleId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error || !sale || (station && sale.merchant_id !== station)) throw new NotFoundException('Vente introuvable');
    if (sale.status !== 'PENDING') throw new BadRequestException('Cette vente a déjà été traitée');

    if (sale.payment_request_id) {
      const { data: closed } = await this.db()
        .from('payment_requests')
        .update({ status: 'CANCELLED' })
        .eq('id', sale.payment_request_id)
        .eq('status', 'CREATED')
        .select('id')
        .maybeSingle();
      if (!closed) throw new BadRequestException('Le client est en train de payer par ScanLinkPay : attendez la confirmation.');
    }

    const { data: cancelled } = await this.db()
      .from('sales')
      .update({ status: 'CANCELLED' })
      .eq('id', sale.id)
      .eq('status', 'PENDING')
      .select('id, status')
      .maybeSingle();
    if (!cancelled) throw new BadRequestException('Cette vente a déjà été traitée');
    return cancelled;
  }

  async payCash(orgId: string, saleId: string, callerId: string, callerOrgId: string | undefined, callerRole?: string) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SELLER_ROLES);
    const { data: sale, error } = await this.db()
      .from('sales')
      .select('id, reference, merchant_id, created_by, status, payment_request_id')
      .eq('id', saleId)
      .eq('organization_id', orgId)
      .single();
    if (station && sale && sale.merchant_id !== station) throw new NotFoundException('Vente introuvable');
    if (error || !sale) throw new NotFoundException('Vente introuvable');
    if (sale.status !== 'PENDING') throw new BadRequestException('Cette vente a déjà été traitée');
    await this.assertStillInStock(sale.id);

    // Close the payment QR FIRST, and only if nobody is paying it: a client confirming with their PIN at the same
    // moment has already claimed it (CREATED -> PENDING) and will be debited — taking the cash too would make them
    // pay twice. Whoever claims the request first wins.
    if (sale.payment_request_id) {
      const { data: closed, error: closeError } = await this.db()
        .from('payment_requests')
        .update({ status: 'CANCELLED' })
        .eq('id', sale.payment_request_id)
        .eq('status', 'CREATED')
        .select('id')
        .maybeSingle();
      if (closeError) throw new Error(`Failed to close payment request: ${closeError.message}`);
      if (!closed) {
        throw new BadRequestException('Le client est en train de payer (ou a payé) par ScanLinkPay : ne prenez pas les espèces, attendez la confirmation.');
      }
    }

    const { data: updated, error: updateError } = await this.db()
      .from('sales')
      .update({ status: 'PAID', payment_method: 'cash', paid_at: new Date().toISOString() })
      .eq('id', sale.id)
      .eq('status', 'PENDING')
      .select()
      .maybeSingle();
    if (updateError || !updated) throw new BadRequestException('Cette vente a déjà été traitée');

    await this.releaseStock(sale);
    return updated;
  }

  /** Financial dashboard numbers for paid sales in [from, to). Money is always
   * kept per currency — CDF and USD are never summed together. Net margin
   * deducts the platform/PSP fees recorded on the linked wallet transaction. */
  async getStats(orgId: string, callerId: string, callerOrgId: string | undefined, from?: string, to?: string, callerRole?: string) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);

    let query = this.db()
      .from('sales')
      .select('id, currency, total_cents, paid_at, transaction_id, sale_items(name, category, stock_item_id, quantity, unit_price_cents, unit_cost_cents)')
      .eq('organization_id', orgId)
      .eq('status', 'PAID');
    query = this.inStation(query, station);
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
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_VIEW_ROLES);

    let query = this.db()
      .from('sales')
      .select('id, reference, status, payment_method, currency, total_cents, paid_at, created_at, sale_items(name, quantity)')
      .eq('organization_id', orgId)
      .is('history_hidden_at', null)
      .order('created_at', { ascending: false })
      .limit(500);
    query = this.inStation(query, station);
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
    managementPassword: string | undefined,
  ) {
    const station = await this.assertOrgAccess(orgId, callerId, callerOrgId, callerRole, SALES_ARCHIVE_ROLES);
    // Only when the owner switched the stock password on.
    if (await this.stockPasswordService.isRequired(orgId)) {
      if (!managementPassword) throw new BadRequestException('Mot de passe de gestion requis');
      await this.stockPasswordService.verifyPassword(orgId, managementPassword);
    }

    const { data, error } = await this.inStation(this.db()
      .from('sales')
      .update({ history_hidden_at: new Date().toISOString() })
      .eq('id', saleId)
      .eq('organization_id', orgId), station)
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
