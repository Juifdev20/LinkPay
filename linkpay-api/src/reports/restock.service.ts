import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { requireStaffStation } from '../common/org-access';

/** Station staff who ask for a restock and confirm its arrival (with the owner). */
export const RESTOCK_ROLES = ['gerant', 'magasinier'];
const MAX_ITEMS = 50;

type Caller = { id: string; role?: string; organization_id?: string };

/**
 * Restock requests: a station's manager or stock keeper asks the owner to buy
 * what runs low; the owner approves or refuses; the station then marks the
 * goods received. Each step tells the other side (notifications). Stock
 * itself is still entered by the stock keeper when the goods arrive.
 */
@Injectable()
export class RestockService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private organizationsService: OrganizationsService,
    private notifications: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async create(merchantId: string, caller: Caller, input: { items: { stock_item_id: string; wanted_qty: number }[]; note?: string }) {
    const merchant = await this.stockService.resolveMerchantAccess(merchantId, caller.id, caller.role, caller.organization_id, RESTOCK_ROLES);
    if (!merchant.organization_id) throw new BadRequestException("Cette station ne fait partie d'aucune entreprise");

    const wanted = (input.items || []).filter((i) => i?.stock_item_id && Number.isInteger(i.wanted_qty) && i.wanted_qty > 0);
    if (!wanted.length) throw new BadRequestException('Indiquez au moins un produit et la quantité voulue.');
    if (wanted.length > MAX_ITEMS) throw new BadRequestException(`Pas plus de ${MAX_ITEMS} produits par demande.`);

    // Names and current quantities come from the station's own stock, never from the request.
    const { data: stock } = await this.db
      .from('stock_items')
      .select('id, name, quantity')
      .eq('merchant_id', merchantId)
      .in('id', wanted.map((i) => i.stock_item_id));
    const byId = new Map((stock || []).map((s) => [s.id, s]));
    const items = wanted
      .filter((i) => byId.has(i.stock_item_id))
      .map((i) => ({ stock_item_id: i.stock_item_id, name: byId.get(i.stock_item_id)!.name, current_qty: byId.get(i.stock_item_id)!.quantity, wanted_qty: Math.min(i.wanted_qty, 1_000_000) }));
    if (!items.length) throw new BadRequestException("Ces produits n'appartiennent pas à cette station.");

    const { data: request, error } = await this.db
      .from('restock_requests')
      .insert({ organization_id: merchant.organization_id, merchant_id: merchantId, requested_by: caller.id, items, note: input.note?.trim().slice(0, 500) || null })
      .select()
      .single();
    if (error) throw new Error(`Failed to create restock request: ${error.message}`);

    const org = await this.organizationsService.getOrganizationById(merchant.organization_id);
    if (org.owner_id !== caller.id) {
      await this.notifications.create({
        user_id: org.owner_id,
        type: 'restock_request',
        title: `Demande de réapprovisionnement — ${merchant.name}`,
        body: `${items.length} produit(s) : ${items.slice(0, 4).map((i) => `${i.name} × ${i.wanted_qty}`).join(', ')}${items.length > 4 ? '…' : ''}.`,
        data: { request_id: request.id, merchant_id: merchantId, url: '/dashboard/organization/restock' },
      }).catch(() => undefined);
    }
    return request;
  }

  /** The owner sees every station's requests; a manager or stock keeper, their station's. */
  async list(orgId: string, caller: Caller, filters: { status?: string; merchant_id?: string } = {}) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    let stationId: string | undefined = filters.merchant_id;
    if (org.owner_id !== caller.id) {
      if (caller.organization_id !== orgId || !RESTOCK_ROLES.includes(caller.role || '')) {
        throw new ForbiddenException("Vous n'avez pas accès aux demandes de réapprovisionnement");
      }
      stationId = await requireStaffStation(this.db, caller.id, orgId);
    }

    let query = this.db.from('restock_requests').select('*').eq('organization_id', orgId);
    if (stationId) query = query.eq('merchant_id', stationId);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(`Failed to list restock requests: ${error.message}`);

    const rows = data || [];
    const userIds = [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by, r.received_by]).filter(Boolean))];
    const stationIds = [...new Set(rows.map((r) => r.merchant_id))];
    const [{ data: people }, { data: stations }] = await Promise.all([
      userIds.length ? this.db.from('profiles').select('id, full_name, email').in('id', userIds) : Promise.resolve({ data: [] as any[] }),
      stationIds.length ? this.db.from('merchants').select('id, name').in('id', stationIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const name = new Map((people || []).map((p: any) => [p.id, p.full_name || p.email]));
    const station = new Map((stations || []).map((s: any) => [s.id, s.name]));
    return rows.map((r) => ({
      ...r,
      station_name: station.get(r.merchant_id) || null,
      requested_by_name: r.requested_by ? name.get(r.requested_by) || null : null,
      decided_by_name: r.decided_by ? name.get(r.decided_by) || null : null,
      received_by_name: r.received_by ? name.get(r.received_by) || null : null,
    }));
  }

  /**
   * pending → approved | rejected: the owner decides.
   * approved → received: the owner, or the station's manager / stock keeper, once the goods are in.
   */
  async update(orgId: string, requestId: string, caller: Caller, input: { status: string; note?: string }) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    const { data: request } = await this.db.from('restock_requests').select('*').eq('id', requestId).eq('organization_id', orgId).maybeSingle();
    if (!request) throw new NotFoundException('Demande introuvable');
    const isOwner = org.owner_id === caller.id;
    const now = new Date().toISOString();
    let changes: Record<string, any>;

    if (input.status === 'approved' || input.status === 'rejected') {
      if (!isOwner) throw new ForbiddenException("Seul le responsable de l'entreprise valide ou refuse une demande");
      if (request.status !== 'pending') throw new BadRequestException('Cette demande a déjà été traitée');
      changes = { status: input.status, decided_by: caller.id, decided_at: now, decision_note: input.note?.trim().slice(0, 500) || null };
    } else if (input.status === 'received') {
      if (!isOwner) {
        if (caller.organization_id !== orgId || !RESTOCK_ROLES.includes(caller.role || '')) throw new ForbiddenException('Action non autorisée');
        const station = await requireStaffStation(this.db, caller.id, orgId);
        if (station !== request.merchant_id) throw new ForbiddenException("Cette demande n'est pas celle de votre station");
      }
      if (request.status !== 'approved') throw new BadRequestException('Seule une demande validée peut être marquée reçue');
      changes = { status: 'received', received_by: caller.id, received_at: now };
    } else {
      throw new BadRequestException('Statut invalide');
    }

    const { data: updated, error } = await this.db
      .from('restock_requests')
      .update(changes)
      .eq('id', requestId)
      .eq('status', request.status)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Failed to update restock request: ${error.message}`);
    if (!updated) throw new BadRequestException('Cette demande vient de changer, actualisez la liste');

    // Tell the other side.
    const { data: station } = await this.db.from('merchants').select('name').eq('id', request.merchant_id).maybeSingle();
    const where = station?.name || 'la station';
    if (changes.status === 'received') {
      if (!isOwner) {
        await this.notifications.create({
          user_id: org.owner_id, type: 'restock_request', title: `Marchandise reçue — ${where}`,
          body: 'La station a confirmé la réception de la commande.', data: { request_id: requestId, url: '/dashboard/organization/restock' },
        }).catch(() => undefined);
      }
    } else if (request.requested_by && request.requested_by !== caller.id) {
      await this.notifications.create({
        user_id: request.requested_by,
        type: 'restock_request',
        title: changes.status === 'approved' ? 'Réapprovisionnement validé' : 'Réapprovisionnement refusé',
        body: `Votre demande pour ${where} a été ${changes.status === 'approved' ? 'validée' : 'refusée'}${changes.decision_note ? ` : « ${changes.decision_note} »` : ''}.`,
        data: { request_id: requestId, url: '/dashboard/organization/restock' },
      }).catch(() => undefined);
    }
    return updated;
  }
}
