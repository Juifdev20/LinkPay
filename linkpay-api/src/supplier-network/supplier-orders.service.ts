import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { SupplierNetworkService, Caller } from './supplier-network.service';
import { SupplierPlanService } from './supplier-plan.service';

const MAX_LINES = 100;
/** How long the client has to pay a confirmed order by ScanLinkPay (the link then expires; offline payment stays possible). */
const PAYMENT_LINK_TTL_MS = 30 * 86_400_000;
const ORDERS_URL = '/dashboard/organization/supplier-orders';
const SALES_URL = '/dashboard/organization/supplier?onglet=commandes';

type Side = 'client' | 'supplier';
const money = (cents: number, currency: string) => `${(cents / 100).toLocaleString('fr-FR')} ${currency}`;

/**
 * Orders between enterprises (DECISIONS.md 23/10, phase C), for every sector:
 *
 *   submitted ── supplier confirms + sets this order's delivery fee ──▶ confirmed
 *   confirmed ── paid by ScanLinkPay (payment request) or confirmed paid by the supplier (cash / Mobile Money) ──▶ paid
 *   paid ── supplier validates the delivery (its stock goes out) ──▶ delivered
 *   delivered ── client confirms reception (its stock comes in, purchase price = order price) ──▶ received
 *   submitted / confirmed ── supplier refuses ──▶ refused ; client cancels ──▶ cancelled
 *
 * Every step notifies the other side (owner + managers concerned) and is a ticket the screens print. No money moves
 * here: a ScanLinkPay payment is an ordinary payment request to the supplier's shipping station.
 */
@Injectable()
export class SupplierOrdersService {
  private readonly logger = new Logger(SupplierOrdersService.name);

  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private network: SupplierNetworkService,
    private plan: SupplierPlanService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ------------------------------------------------------------------ reading

  private async load(orderId: string) {
    const { data, error } = await this.db.from('supplier_orders').select('*, items:supplier_order_items(*)').eq('id', orderId).maybeSingle();
    if (error) this.network.fail(error);
    if (!data) throw new NotFoundException('Commande introuvable');
    return data;
  }

  /**
   * The order as seen from `orgId`, after checking the caller may act on that side: supplier side = owner or manager
   * of the shipping station; client side = owner, or a manager / stock keeper of the receiving station.
   */
  private async open(orgId: string, orderId: string, caller: Caller, want?: Side) {
    const order = await this.load(orderId);
    const side: Side | null = order.supplier_org_id === orgId ? 'supplier' : order.client_org_id === orgId ? 'client' : null;
    if (!side || (want && side !== want)) throw new NotFoundException('Commande introuvable');
    if (side === 'supplier') {
      const m = await this.network.member(orgId, caller);
      if (!m.isOwner && m.station !== order.supplier_merchant_id) throw new ForbiddenException("Cette commande part d'une autre station");
    } else {
      const m = await this.network.member(orgId, caller, ['gerant', 'magasinier']);
      if (!m.isOwner && m.station !== order.client_merchant_id) throw new ForbiddenException("Cette commande est celle d'une autre station");
    }
    return { order, side };
  }

  private async decorate(orders: any[]) {
    if (!orders.length) return [];
    const orgIds = [...new Set(orders.flatMap((o) => [o.client_org_id, o.supplier_org_id]))];
    const stationIds = [...new Set(orders.flatMap((o) => [o.client_merchant_id, o.supplier_merchant_id]))];
    const requestIds = orders.map((o) => o.payment_request_id).filter(Boolean);
    const [{ data: orgs }, { data: stations }, { data: profiles }, { data: requests }] = await Promise.all([
      this.db.from('organizations').select('id, name').in('id', orgIds),
      this.db.from('merchants').select('id, name').in('id', stationIds),
      this.db.from('supplier_profiles').select('organization_id, display_name, supplier_number, phone').in('organization_id', orgIds),
      requestIds.length ? this.db.from('payment_requests').select('id, link_token, status, expires_at').in('id', requestIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const orgName = new Map((orgs || []).map((o: any) => [o.id, o.name]));
    const stationName = new Map((stations || []).map((s: any) => [s.id, s.name]));
    const profile = new Map((profiles || []).map((p: any) => [p.organization_id, p]));
    const request = new Map((requests || []).map((r: any) => [r.id, r]));
    return orders.map((o) => {
      const p: any = profile.get(o.supplier_org_id);
      const r: any = o.payment_request_id ? request.get(o.payment_request_id) : null;
      return {
        ...o,
        client_name: orgName.get(o.client_org_id) || 'Entreprise',
        client_station_name: stationName.get(o.client_merchant_id) || null,
        supplier_name: p?.display_name || orgName.get(o.supplier_org_id) || 'Fournisseur',
        supplier_number: p?.supplier_number || null,
        supplier_phone: p?.phone || null,
        supplier_station_name: stationName.get(o.supplier_merchant_id) || null,
        // The ScanLinkPay link, while it can still be paid.
        payment_link_token: o.status === 'confirmed' && r && r.status === 'CREATED' && new Date(r.expires_at).getTime() > Date.now() ? r.link_token : null,
      };
    });
  }

  async list(orgId: string, caller: Caller, side: Side, status?: string) {
    const m = await this.network.member(orgId, caller, side === 'client' ? ['gerant', 'magasinier'] : ['gerant']);
    let query = this.db.from('supplier_orders').select('*, items:supplier_order_items(*)').eq(side === 'client' ? 'client_org_id' : 'supplier_org_id', orgId);
    if (!m.isOwner) query = query.eq(side === 'client' ? 'client_merchant_id' : 'supplier_merchant_id', m.station!);
    if (status) query = query.eq('status', status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
    if (error) this.network.fail(error);
    return this.decorate(data || []);
  }

  async get(orgId: string, orderId: string, caller: Caller) {
    const { order, side } = await this.open(orgId, orderId, caller);
    return { ...(await this.decorate([order]))[0], side };
  }

  // ------------------------------------------------------------------ client: order, cancel, declare a payment

  async create(
    orgId: string,
    caller: Caller,
    input: { supplier_org_id: string; merchant_id?: string; items: { catalog_item_id: string; quantity: number }[]; delivery_requested?: boolean; delivery_address?: string; note?: string },
  ) {
    const m = await this.network.member(orgId, caller);
    // The receiving station: a manager's own; the owner picks one of theirs.
    let station = m.station;
    if (m.isOwner) {
      const stations = await this.network.stationsOf(orgId);
      station = input.merchant_id && stations.some((s: any) => s.id === input.merchant_id) ? input.merchant_id : stations.length === 1 ? stations[0].id : null;
      if (!station) throw new BadRequestException('Choisissez la station qui reçoit la marchandise.');
    }
    await this.network.assertLinked(orgId, input.supplier_org_id);
    const profile = await this.network.profileOf(input.supplier_org_id);
    if (!profile || !profile.active) throw new BadRequestException('Ce fournisseur est fermé');
    this.plan.assertCanSell(profile);

    const wanted = (input.items || []).filter((l) => l?.catalog_item_id && Number.isInteger(l.quantity) && l.quantity > 0);
    if (!wanted.length) throw new BadRequestException('Ajoutez au moins un produit et sa quantité.');
    if (wanted.length > MAX_LINES) throw new BadRequestException(`Pas plus de ${MAX_LINES} produits par commande.`);
    // Prices, names and the station all come from the supplier's catalog, never from the request.
    const { data: catalog } = await this.db.from('supplier_catalog_items').select('*').eq('supplier_org_id', input.supplier_org_id).eq('active', true)
      .in('id', wanted.map((l) => l.catalog_item_id));
    const byId = new Map((catalog || []).map((c: any) => [c.id, c]));
    const { data: stock } = await this.db.from('stock_items').select('id, name, barcode, category, merchant_id')
      .in('id', (catalog || []).map((c: any) => c.stock_item_id)).eq('merchant_id', profile.merchant_id);
    const stockById = new Map((stock || []).map((s: any) => [s.id, s]));
    const lines = wanted.map((l) => {
      const c: any = byId.get(l.catalog_item_id);
      const s: any = c && stockById.get(c.stock_item_id);
      if (!c || !s) throw new BadRequestException("Un produit n'est plus dans le catalogue de ce fournisseur : actualisez.");
      if (l.quantity < c.min_quantity) throw new BadRequestException(`« ${s.name} » : au moins ${c.min_quantity} par commande.`);
      return { c, s, quantity: Math.min(l.quantity, 1_000_000) };
    });
    const currencies = new Set(lines.map((l) => l.c.currency));
    if (currencies.size > 1) throw new BadRequestException('Une commande se fait dans une seule devise : séparez les produits en CDF et en USD.');
    const currency = lines[0].c.currency;
    const subtotal = lines.reduce((sum, l) => sum + l.c.price_cents * l.quantity, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > 1_000_000_000_000_000) throw new BadRequestException('Montant de commande trop élevé : séparez-la en plusieurs commandes.');

    const { data: order, error } = await this.db
      .from('supplier_orders')
      .insert({
        number: `CMD-${randomBytes(4).toString('hex').toUpperCase()}`,
        client_org_id: orgId,
        client_merchant_id: station,
        supplier_org_id: input.supplier_org_id,
        supplier_merchant_id: profile.merchant_id,
        currency,
        subtotal_cents: subtotal,
        total_cents: subtotal,
        delivery_requested: !!input.delivery_requested,
        delivery_address: input.delivery_requested ? input.delivery_address?.trim().slice(0, 255) || null : null,
        note: input.note?.trim().slice(0, 500) || null,
        ordered_by: caller.id,
      })
      .select()
      .single();
    if (error) this.network.fail(error);
    const { error: linesError } = await this.db.from('supplier_order_items').insert(lines.map((l) => ({
      order_id: order.id, catalog_item_id: l.c.id, supplier_stock_item_id: l.s.id, name: l.s.name, barcode: l.s.barcode, category: l.s.category,
      quantity: l.quantity, unit_price_cents: l.c.price_cents,
    })));
    if (linesError) {
      await this.db.from('supplier_orders').delete().eq('id', order.id);
      this.network.fail(linesError);
    }

    await this.network.notify(await this.network.supplierRecipients(profile), caller.id, {
      title: `Nouvelle commande ${order.number}`,
      body: `${m.org.name} : ${lines.length} produit(s), ${money(subtotal, currency)}${input.delivery_requested ? ', avec livraison' : ''}. Confirmez-la${input.delivery_requested ? ' et indiquez les frais de livraison' : ''}.`,
      url: SALES_URL,
      data: { order_id: order.id },
    });
    return this.get(orgId, order.id, caller);
  }

  /** Closes the ScanLinkPay link of an order. False when someone is paying it right now (never touched then). */
  private async closePaymentRequest(requestId: string | null): Promise<boolean> {
    if (!requestId) return true;
    const { data: closed } = await this.db.from('payment_requests').update({ status: 'CANCELLED' }).eq('id', requestId).in('status', ['CREATED', 'EXPIRED']).select('id').maybeSingle();
    if (closed) return true;
    const { data: r } = await this.db.from('payment_requests').select('status').eq('id', requestId).maybeSingle();
    return !r || r.status === 'CANCELLED';
  }

  private async move(order: any, from: string, changes: Record<string, unknown>) {
    const { data, error } = await this.db
      .from('supplier_orders')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', from)
      .select()
      .maybeSingle();
    if (error) this.network.fail(error);
    if (!data) throw new BadRequestException('Cette commande vient de changer, actualisez');
    return data;
  }

  async cancel(orgId: string, orderId: string, caller: Caller, note?: string) {
    const { order } = await this.open(orgId, orderId, caller, 'client');
    if (!['submitted', 'confirmed'].includes(order.status)) throw new BadRequestException('Cette commande ne peut plus être annulée');
    if (!(await this.closePaymentRequest(order.payment_request_id))) {
      throw new BadRequestException('Un paiement ScanLinkPay de cette commande est en cours : attendez son résultat.');
    }
    await this.move(order, order.status, { status: 'cancelled', closed_by: caller.id, closed_at: new Date().toISOString() });
    const profile = await this.network.profileOf(order.supplier_org_id);
    if (profile) {
      await this.network.notify(await this.network.supplierRecipients(profile), caller.id, {
        title: `Commande ${order.number} annulée`, body: `Le client a annulé la commande${note ? ` : « ${note.trim().slice(0, 200)} »` : ''}.`, url: SALES_URL,
      });
    }
    return this.get(orgId, orderId, caller);
  }

  /** The client tells the supplier it paid outside the app (cash, Mobile Money): only the supplier's confirmation makes it paid. */
  async declarePayment(orgId: string, orderId: string, caller: Caller, input: { method: 'cash' | 'mobile_money'; reference?: string }) {
    const { order } = await this.open(orgId, orderId, caller, 'client');
    if (order.status !== 'confirmed') throw new BadRequestException("Seule une commande confirmée et pas encore payée peut l'être");
    if (!['cash', 'mobile_money'].includes(input.method)) throw new BadRequestException('Moyen de paiement inconnu');
    await this.move(order, 'confirmed', { payment_method: input.method, payment_reference: input.reference?.trim().slice(0, 100) || null, client_declared_payment_at: new Date().toISOString() });
    const profile = await this.network.profileOf(order.supplier_org_id);
    if (profile) {
      await this.network.notify(await this.network.supplierRecipients(profile), caller.id, {
        title: `Paiement annoncé — ${order.number}`,
        body: `Le client dit avoir payé ${money(order.total_cents, order.currency)} ${input.method === 'cash' ? 'en espèces' : 'par Mobile Money'}${input.reference ? ` (réf. ${input.reference.trim().slice(0, 100)})` : ''}. Vérifiez puis confirmez le paiement.`,
        url: SALES_URL,
      });
    }
    return this.get(orgId, orderId, caller);
  }

  // ------------------------------------------------------------------ supplier: confirm, refuse, payment, delivery

  /** The supplier confirms and fixes this order's delivery fee; a ScanLinkPay link for the total is made for the client. */
  async confirm(orgId: string, orderId: string, caller: Caller, input: { delivery_fee_cents?: number; note?: string }) {
    const { order } = await this.open(orgId, orderId, caller, 'supplier');
    if (order.status !== 'submitted') throw new BadRequestException('Cette commande a déjà été traitée');
    const fee = order.delivery_requested ? Number(input.delivery_fee_cents ?? 0) : 0;
    if (!Number.isInteger(fee) || fee < 0) throw new BadRequestException('Frais de livraison invalides.');
    const total = Number(order.subtotal_cents) + fee;
    if (!Number.isSafeInteger(total)) throw new BadRequestException('Montant trop élevé.');

    const reference = `REQ-${order.number}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const { data: request, error: reqErr } = await this.db
      .from('payment_requests')
      .insert({
        merchant_id: order.supplier_merchant_id,
        amount_cents: total,
        currency: order.currency,
        reference,
        description: `Commande ${order.number}${fee ? ' (livraison comprise)' : ''}`,
        link_token: randomBytes(32).toString('hex'),
        status: 'CREATED',
        expires_at: new Date(Date.now() + PAYMENT_LINK_TTL_MS).toISOString(),
      })
      .select('id')
      .single();
    if (reqErr || !request) throw new Error(`Failed to create the order's payment request: ${reqErr?.message}`);

    try {
      await this.move(order, 'submitted', {
        status: 'confirmed', delivery_fee_cents: fee, total_cents: total, supplier_note: input.note?.trim().slice(0, 500) || null,
        payment_request_id: request.id, confirmed_by: caller.id, confirmed_at: new Date().toISOString(),
      });
    } catch (err) {
      await this.db.from('payment_requests').update({ status: 'CANCELLED' }).eq('id', request.id).eq('status', 'CREATED');
      throw err;
    }
    await this.network.notify(await this.network.clientRecipients(order.client_org_id, order.client_merchant_id), caller.id, {
      title: `Commande ${order.number} confirmée`,
      body: `Total à payer : ${money(total, order.currency)}${fee ? ` (dont livraison ${money(fee, order.currency)})` : ''}. Payez par ScanLinkPay depuis la commande, ou en espèces / Mobile Money.`,
      url: ORDERS_URL,
      data: { order_id: order.id },
    });
    return this.get(orgId, orderId, caller);
  }

  async refuse(orgId: string, orderId: string, caller: Caller, note?: string) {
    const { order } = await this.open(orgId, orderId, caller, 'supplier');
    if (!['submitted', 'confirmed'].includes(order.status)) throw new BadRequestException('Cette commande ne peut plus être refusée');
    if (!(await this.closePaymentRequest(order.payment_request_id))) {
      throw new BadRequestException('Le client est en train de payer par ScanLinkPay : attendez son résultat.');
    }
    await this.move(order, order.status, { status: 'refused', supplier_note: note?.trim().slice(0, 500) || order.supplier_note, closed_by: caller.id, closed_at: new Date().toISOString() });
    await this.network.notify(await this.network.clientRecipients(order.client_org_id, order.client_merchant_id), caller.id, {
      title: `Commande ${order.number} refusée`, body: note ? `Motif : « ${note.trim().slice(0, 200)} »` : 'Le fournisseur ne peut pas la servir.', url: ORDERS_URL,
    });
    return this.get(orgId, orderId, caller);
  }

  /** The supplier confirms having received the money outside the app. The ScanLinkPay link is closed first. */
  async confirmPayment(orgId: string, orderId: string, caller: Caller, input: { method: 'cash' | 'mobile_money'; reference?: string }) {
    const { order } = await this.open(orgId, orderId, caller, 'supplier');
    if (order.status !== 'confirmed') throw new BadRequestException("Seule une commande confirmée et pas encore payée peut l'être");
    if (!['cash', 'mobile_money'].includes(input.method)) throw new BadRequestException('Moyen de paiement inconnu');
    if (!(await this.closePaymentRequest(order.payment_request_id))) {
      throw new BadRequestException('Un paiement ScanLinkPay de cette commande est en cours : attendez son résultat.');
    }
    await this.move(order, 'confirmed', {
      status: 'paid', payment_method: input.method, payment_reference: input.reference?.trim().slice(0, 100) || order.payment_reference,
      paid_confirmed_by: caller.id, paid_at: new Date().toISOString(),
    });
    await this.network.notify(await this.network.clientRecipients(order.client_org_id, order.client_merchant_id), caller.id, {
      title: `Paiement reçu — ${order.number}`, body: `Le fournisseur confirme avoir reçu ${money(order.total_cents, order.currency)}. La livraison suit.`, url: ORDERS_URL,
    });
    return this.get(orgId, orderId, caller);
  }

  /**
   * Called by PaymentsService once the order's payment request is paid (wallet, Mobile Money, card). Idempotent: an
   * order no longer "confirmed" is left alone. Returns whether a supplier order was paid.
   */
  async markPaidByPaymentRequest(paymentRequestId: string, transactionId: string | undefined): Promise<boolean> {
    const { data: order } = await this.db.from('supplier_orders').select('*').eq('payment_request_id', paymentRequestId).maybeSingle();
    if (!order || order.status !== 'confirmed') return false;
    const { data: paid } = await this.db
      .from('supplier_orders')
      .update({ status: 'paid', payment_method: 'scanlinkpay', transaction_id: transactionId ?? null, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'confirmed')
      .select('id')
      .maybeSingle();
    if (!paid) return false;
    const profile = await this.network.profileOf(order.supplier_org_id);
    if (profile) {
      await this.network.notify(await this.network.supplierRecipients(profile), '', {
        title: `Commande ${order.number} payée`, body: `${money(order.total_cents, order.currency)} reçus par ScanLinkPay. Préparez et validez la livraison.`, url: SALES_URL,
      });
    }
    await this.network.notify(await this.network.clientRecipients(order.client_org_id, order.client_merchant_id), '', {
      title: `Paiement effectué — ${order.number}`, body: 'Le fournisseur a reçu votre paiement. La livraison suit.', url: ORDERS_URL,
    });
    return true;
  }

  /** The supplier validates the delivery: its shipping station's stock goes out (once, even if sent twice). */
  async deliver(orgId: string, orderId: string, caller: Caller) {
    const { order } = await this.open(orgId, orderId, caller, 'supplier');
    if (order.status !== 'paid') throw new BadRequestException('La livraison se valide une fois la commande payée');
    // Enough of everything before anything goes out (a line already taken out by an earlier try counts as done).
    const ids = (order.items || []).map((l: any) => l.supplier_stock_item_id).filter(Boolean);
    const { data: stock } = ids.length ? await this.db.from('stock_items').select('id, quantity').in('id', ids) : { data: [] as any[] };
    const { data: done } = await this.db.from('stock_movements').select('client_ref').eq('merchant_id', order.supplier_merchant_id)
      .in('client_ref', (order.items || []).map((l: any) => l.out_ref));
    const doneRefs = new Set((done || []).map((d: any) => d.client_ref));
    const left = new Map((stock || []).map((s: any) => [s.id, s.quantity]));
    for (const line of order.items || []) {
      if (!line.supplier_stock_item_id || doneRefs.has(line.out_ref)) continue;
      const have = left.get(line.supplier_stock_item_id) ?? 0;
      if (have < line.quantity) throw new BadRequestException(`« ${line.name} » : il ne reste que ${have} en stock pour ${line.quantity} commandé(s). Réapprovisionnez avant de livrer.`);
    }
    for (const line of order.items || []) {
      if (!line.supplier_stock_item_id) continue; // article deleted since: nothing left to take out
      await this.stockService.createMovement(order.supplier_merchant_id, line.supplier_stock_item_id, caller.id, caller.role || '', caller.organization_id, {
        type: 'out', quantity_delta: -line.quantity, reason: `Livraison commande ${order.number}`, client_ref: line.out_ref,
      });
    }
    await this.move(order, 'paid', { status: 'delivered', delivered_by: caller.id, delivered_at: new Date().toISOString() });
    await this.network.notify(await this.network.clientRecipients(order.client_org_id, order.client_merchant_id), caller.id, {
      title: `Commande ${order.number} livrée`, body: 'Vérifiez la marchandise puis confirmez la réception : votre stock sera mis à jour.', url: ORDERS_URL,
    });
    return this.get(orgId, orderId, caller);
  }

  // ------------------------------------------------------------------ client: reception

  /**
   * The client confirms reception: each line goes into a product of the receiving station — the one picked, else the
   * one with the same barcode, else a new product (its sale price must then be given). Stock comes in (once, even if
   * sent twice), the purchase price becomes the order's unit price (same currency) and the supplier is filled in.
   */
  async receive(orgId: string, orderId: string, caller: Caller, input: { lines?: { order_item_id: string; stock_item_id?: string; sale_price_cents?: number }[] }) {
    const { order } = await this.open(orgId, orderId, caller, 'client');
    if (order.status !== 'delivered') throw new BadRequestException('La réception se confirme une fois la commande livrée');
    const choices = new Map((input.lines || []).map((l) => [l.order_item_id, l]));
    const station = order.client_merchant_id;
    const { data: stock } = await this.db.from('stock_items').select('id, name, barcode, currency').eq('merchant_id', station);
    const byId = new Map((stock || []).map((s: any) => [s.id, s]));
    const byBarcode = new Map((stock || []).filter((s: any) => s.barcode).map((s: any) => [s.barcode, s]));
    const { data: supplierEntry } = await this.db.from('suppliers').select('id').eq('organization_id', orgId).eq('supplier_org_id', order.supplier_org_id).is('archived_at', null).maybeSingle();

    // Every line is matched before anything moves: a missing sale price stops the whole reception.
    const plan = (order.items || []).map((line: any) => {
      const choice = choices.get(line.id);
      const target = (choice?.stock_item_id && byId.get(choice.stock_item_id)) || (line.client_stock_item_id && byId.get(line.client_stock_item_id)) || (line.barcode && byBarcode.get(line.barcode)) || null;
      if (choice?.stock_item_id && !byId.has(choice.stock_item_id)) throw new BadRequestException(`« ${line.name} » : ce produit n'est pas dans le stock de la station.`);
      if (!target && !(Number.isInteger(choice?.sale_price_cents) && choice!.sale_price_cents! > 0)) {
        throw new BadRequestException(`« ${line.name} » est nouveau chez vous : indiquez son prix de vente.`);
      }
      return { line, target, salePrice: choice?.sale_price_cents };
    });

    for (const { line, target, salePrice } of plan) {
      let item = target;
      if (!item) {
        item = await this.stockService.createItem(station, caller.id, caller.role || '', caller.organization_id, {
          name: line.name, barcode: line.barcode || undefined, category: line.category || undefined, quantity: 0,
          unit_price_cents: salePrice, cost_price_cents: line.unit_price_cents, currency: order.currency,
          ...(supplierEntry ? { supplier_id: supplierEntry.id } : {}),
        });
        // Remembered at once: a reception sent again finds this product instead of creating a second one.
        await this.db.from('supplier_order_items').update({ client_stock_item_id: item.id }).eq('id', line.id);
      } else {
        // Purchase price from this order (same currency only), supplier filled in.
        const changes: Record<string, unknown> = {};
        if (item.currency === order.currency) changes.cost_price_cents = line.unit_price_cents;
        if (supplierEntry) changes.supplier_id = supplierEntry.id;
        if (Object.keys(changes).length) await this.db.from('stock_items').update(changes).eq('id', item.id).eq('merchant_id', station);
      }
      await this.stockService.createMovement(station, item.id, caller.id, caller.role || '', caller.organization_id, {
        type: 'in', quantity_delta: line.quantity, reason: `Réception commande ${order.number}`, client_ref: line.in_ref,
      });
      await this.db.from('supplier_order_items').update({ client_stock_item_id: item.id }).eq('id', line.id);
    }
    await this.move(order, 'delivered', { status: 'received', received_by: caller.id, received_at: new Date().toISOString() });
    const profile = await this.network.profileOf(order.supplier_org_id);
    if (profile) {
      await this.network.notify(await this.network.supplierRecipients(profile), caller.id, {
        title: `Commande ${order.number} reçue`, body: 'Le client a confirmé la réception. Commande terminée.', url: SALES_URL,
      });
    }
    return this.get(orgId, orderId, caller);
  }
}
