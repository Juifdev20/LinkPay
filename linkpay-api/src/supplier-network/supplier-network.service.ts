import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { requireStaffStation, stationStaffWithRoles } from '../common/org-access';
import { SupplierPlanService } from './supplier-plan.service';
import { sameName } from '../stock/suppliers.service';

export type Caller = { id: string; role?: string; organization_id?: string };

const clean = (v: string | null | undefined, max: number) => (v == null ? null : v.trim().replace(/\s+/g, ' ').slice(0, max) || null);

export interface ProfileInput {
  display_name?: string;
  phone?: string | null;
  address?: string | null;
  delivery_zone?: string | null;
  description?: string | null;
  merchant_id?: string;
  default_delivery_fee_cents?: number | null;
  default_delivery_currency?: 'CDF' | 'USD' | null;
}

/**
 * The supplier network (DECISIONS.md 23/10, phase C), for every sector: an enterprise becomes a supplier (its owner
 * switches it on: number, name, the station the goods leave from, a free trial then the paid plan), publishes a
 * catalog drawn from that station's stock at its own business prices, and accepts the enterprises that invite it.
 * Orders are in SupplierOrdersService.
 *
 * Who does what — supplier side: the owner, and the managers of the shipping station (they are notified and
 * validate); only the owner switches it on, changes the profile and pays. Client side: the owner and the managers
 * invite and order.
 */
@Injectable()
export class SupplierNetworkService {
  constructor(
    private supabaseService: SupabaseService,
    private organizationsService: OrganizationsService,
    private notifications: NotificationsService,
    private plan: SupplierPlanService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  fail(error: { message: string; code?: string }): never {
    if (/supplier_|purchase_supplier_plan/.test(error.message) && /schema cache|does not exist|Could not find/.test(error.message)) {
      throw new ServiceUnavailableException("Le réseau de fournisseurs n'existe pas encore : appliquez la migration 084_supplier_network.sql.");
    }
    throw new Error(`Supplier network: ${error.message}`);
  }

  // ------------------------------------------------------------------ who is calling

  /** The owner of `orgId`, or one of its staff holding `roles` (with their station). Anyone else is refused. */
  async member(orgId: string, caller: Caller, roles: string[] = ['gerant']) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    if (org.owner_id === caller.id) return { org, isOwner: true, station: null as string | null };
    if (caller.organization_id !== orgId || !roles.includes(caller.role || '')) {
      throw new ForbiddenException("Réservé au patron et au gérant de l'entreprise");
    }
    const station = await requireStaffStation(this.db, caller.id, orgId);
    return { org, isOwner: false, station };
  }

  /** Supplier side: the owner, or a manager of the shipping station. */
  async supplierSide(orgId: string, caller: Caller) {
    const m = await this.member(orgId, caller);
    const profile = await this.profileOf(orgId);
    if (!profile) throw new NotFoundException("Cette entreprise n'est pas fournisseur");
    if (!m.isOwner && m.station !== profile.merchant_id) {
      throw new ForbiddenException("Seuls le patron et le gérant de la station d'expédition gèrent les ventes aux entreprises");
    }
    return { ...m, profile };
  }

  /** Owner and managers of the shipping station: who is told about invitations and orders. */
  async supplierRecipients(profile: { organization_id: string; merchant_id: string }) {
    const org = await this.organizationsService.getOrganizationById(profile.organization_id);
    const managers = await stationStaffWithRoles(this.db, profile.merchant_id, ['gerant']);
    return [...new Set([org.owner_id, ...managers])];
  }

  /** Owner and managers of a client station (the managers of `merchantId`, or all of the owner's when null). */
  async clientRecipients(orgId: string, merchantId: string | null) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    const managers = merchantId ? await stationStaffWithRoles(this.db, merchantId, ['gerant']) : [];
    return [...new Set([org.owner_id, ...managers])];
  }

  async notify(userIds: string[], exceptId: string, n: { title: string; body: string; url: string; data?: Record<string, unknown> }) {
    for (const userId of userIds) {
      if (userId === exceptId) continue;
      await this.notifications.create({ user_id: userId, type: 'supplier_network', title: n.title, body: n.body, data: { url: n.url, ...(n.data || {}) } })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ profile & plan

  async profileOf(orgId: string) {
    const { data, error } = await this.db.from('supplier_profiles').select('*').eq('organization_id', orgId).maybeSingle();
    if (error) this.fail(error);
    return data;
  }

  /** "Devenir fournisseur": the profile (or null) with its plan, and the offer (trial days, prices) set by the super admin. */
  async myProfile(orgId: string, caller: Caller) {
    await this.member(orgId, caller);
    const [profile, offer] = await Promise.all([this.profileOf(orgId), this.plan.offer()]);
    return { profile, plan: profile ? this.plan.stateOf(profile) : null, offer };
  }

  stationsOf(orgId: string) {
    return this.organizationsService.getOrganizationMerchants(orgId);
  }

  private async checkStation(orgId: string, merchantId: string) {
    const stations = await this.stationsOf(orgId);
    if (!stations.some((s: any) => s.id === merchantId)) throw new BadRequestException("Cette station n'appartient pas à l'entreprise");
  }

  private profileChanges(input: ProfileInput) {
    const c: Record<string, unknown> = {};
    if (input.display_name !== undefined) {
      const name = clean(input.display_name, 120);
      if (!name) throw new BadRequestException('Indiquez le nom affiché à vos clients.');
      c.display_name = name;
    }
    if (input.phone !== undefined) c.phone = clean(input.phone, 30);
    if (input.address !== undefined) c.address = clean(input.address, 255);
    if (input.delivery_zone !== undefined) c.delivery_zone = clean(input.delivery_zone, 255);
    if (input.description !== undefined) c.description = clean(input.description, 1000);
    if (input.default_delivery_fee_cents !== undefined) {
      const fee = input.default_delivery_fee_cents;
      if (fee !== null && (!Number.isInteger(fee) || fee < 0)) throw new BadRequestException('Frais de livraison invalides.');
      c.default_delivery_fee_cents = fee;
      c.default_delivery_currency = fee === null ? null : input.default_delivery_currency || 'CDF';
    }
    return c;
  }

  /** The owner switches it on: a supplier number, and the free trial from now (length set by the super admin). */
  async becomeSupplier(orgId: string, caller: Caller, input: ProfileInput) {
    const { org, isOwner } = await this.member(orgId, caller);
    if (!isOwner) throw new ForbiddenException('Seul le patron peut faire de son entreprise un fournisseur');
    if (await this.profileOf(orgId)) throw new BadRequestException('Votre entreprise est déjà fournisseur');
    if (!input.merchant_id) throw new BadRequestException("Choisissez la station d'où partent les marchandises.");
    await this.checkStation(orgId, input.merchant_id);
    const changes = this.profileChanges({ display_name: input.display_name ?? org.name, ...input });
    const settings = await this.plan.getSettings();
    const trialEnds = new Date(Date.now() + settings.trial_days * 86_400_000).toISOString();
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = `F-${randomInt(100000, 1000000)}`;
      const { data, error } = await this.db
        .from('supplier_profiles')
        .insert({ organization_id: orgId, supplier_number: number, merchant_id: input.merchant_id, trial_ends_at: trialEnds, created_by: caller.id, ...changes })
        .select()
        .single();
      if (!error) {
        // Told at once how long the free trial lasts (the super admin's length) and what follows.
        const offer = await this.plan.offer();
        const price = Object.entries(offer.prices).map(([c, v]) => `${(v / 100).toLocaleString('fr-FR')} ${c}`).join(' ou ');
        await this.notify([caller.id], '', {
          title: settings.trial_days > 0 ? `Essai gratuit Fournisseur : ${settings.trial_days} jour${settings.trial_days > 1 ? 's' : ''}` : 'Vous êtes fournisseur',
          body: `Votre numéro de fournisseur : ${number}. ${settings.trial_days > 0 ? `Vos clients peuvent vous commander gratuitement jusqu'au ${new Date(trialEnds).toLocaleDateString('fr-FR')}. ` : ''}Ensuite : ${price || 'le prix sera annoncé'} par mois${offer.annual_free_months ? `, ou l'année avec ${offer.annual_free_months} mois offerts` : ''}.`,
          url: '/dashboard/organization/supplier',
        });
        return { profile: data, plan: this.plan.stateOf(data), offer };
      }
      if (error.code === '23505' && /supplier_number/.test(error.message)) continue;
      if (error.code === '23505') throw new BadRequestException('Votre entreprise est déjà fournisseur');
      this.fail(error);
    }
    throw new Error('Could not draw a free supplier number');
  }

  async updateProfile(orgId: string, caller: Caller, input: ProfileInput & { active?: boolean }) {
    const { isOwner } = await this.member(orgId, caller);
    if (!isOwner) throw new ForbiddenException('Seul le patron modifie la fiche fournisseur');
    const changes = this.profileChanges(input);
    if (input.merchant_id !== undefined) {
      await this.checkStation(orgId, input.merchant_id);
      changes.merchant_id = input.merchant_id;
    }
    if (input.active !== undefined) changes.active = !!input.active;
    const { data, error } = await this.db
      .from('supplier_profiles')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException("Votre entreprise n'est pas fournisseur");
    return { profile: data, plan: this.plan.stateOf(data) };
  }

  // ------------------------------------------------------------------ catalog (supplier side)

  /** Every article of the shipping station, with its business price when it is in the catalog. */
  async myCatalog(orgId: string, caller: Caller) {
    const { profile } = await this.supplierSide(orgId, caller);
    const [{ data: stock, error }, { data: catalog }] = await Promise.all([
      this.db.from('stock_items').select('id, name, barcode, category, quantity, unit_price_cents, cost_price_cents, currency').eq('merchant_id', profile.merchant_id).order('name'),
      this.db.from('supplier_catalog_items').select('*').eq('supplier_org_id', orgId),
    ]);
    if (error) this.fail(error);
    const byItem = new Map((catalog || []).map((c: any) => [c.stock_item_id, c]));
    return (stock || []).map((s: any) => ({ ...s, catalog: byItem.get(s.id) || null }));
  }

  /** Puts an article of the shipping station in the catalog (or changes its price), or takes it out (active false). */
  async setCatalogItem(orgId: string, caller: Caller, stockItemId: string, input: { price_cents: number; min_quantity?: number; active?: boolean }) {
    const { profile } = await this.supplierSide(orgId, caller);
    const { data: item } = await this.db.from('stock_items').select('id, currency').eq('id', stockItemId).eq('merchant_id', profile.merchant_id).maybeSingle();
    if (!item) throw new BadRequestException("Cet article n'est pas dans le stock de la station d'expédition.");
    if (!Number.isInteger(input.price_cents) || input.price_cents <= 0) throw new BadRequestException('Indiquez le prix de vente aux entreprises.');
    const min = input.min_quantity ?? 1;
    if (!Number.isInteger(min) || min < 1) throw new BadRequestException('Quantité minimum invalide.');
    const { data, error } = await this.db
      .from('supplier_catalog_items')
      .upsert(
        { supplier_org_id: orgId, stock_item_id: stockItemId, price_cents: input.price_cents, currency: item.currency, min_quantity: min, active: input.active ?? true, updated_at: new Date().toISOString() },
        { onConflict: 'supplier_org_id,stock_item_id' },
      )
      .select()
      .single();
    if (error) this.fail(error);
    return data;
  }

  // ------------------------------------------------------------------ links (invitations)

  /** What a client sees before inviting: the supplier's public card, from its number. */
  async lookup(orgId: string, caller: Caller, number: string) {
    await this.member(orgId, caller);
    const { data, error } = await this.db
      .from('supplier_profiles')
      .select('organization_id, supplier_number, display_name, address, delivery_zone, description, active, trial_ends_at, plan_expires_at')
      .eq('supplier_number', (number || '').trim().toUpperCase())
      .maybeSingle();
    if (error) this.fail(error);
    if (!data || !data.active) throw new NotFoundException('Aucun fournisseur avec ce numéro');
    if (data.organization_id === orgId) throw new BadRequestException("C'est votre propre numéro de fournisseur");
    const { trial_ends_at, plan_expires_at, ...card } = data;
    return { ...card, takes_orders: this.plan.stateOf({ trial_ends_at, plan_expires_at }).can_sell };
  }

  async listLinks(orgId: string, caller: Caller) {
    const { isOwner } = await this.member(orgId, caller, ['gerant', 'magasinier']);
    const seesClients = isOwner || caller.role === 'gerant';
    const [{ data: asClient, error }, { data: asSupplier }] = await Promise.all([
      this.db.from('supplier_links').select('*').eq('client_org_id', orgId).order('created_at', { ascending: false }),
      this.db.from('supplier_links').select('*').eq('supplier_org_id', orgId).order('created_at', { ascending: false }),
    ]);
    if (error) this.fail(error);
    const orgIds = [...new Set([...(asClient || []).map((l: any) => l.supplier_org_id), ...(asSupplier || []).map((l: any) => l.client_org_id)])];
    const [{ data: orgs }, { data: profiles }] = await Promise.all([
      orgIds.length ? this.db.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as any[] }),
      orgIds.length ? this.db.from('supplier_profiles').select('organization_id, supplier_number, display_name, delivery_zone, default_delivery_fee_cents, default_delivery_currency, trial_ends_at, plan_expires_at, active').in('organization_id', orgIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const orgName = new Map((orgs || []).map((o: any) => [o.id, o.name]));
    const profileOf = new Map((profiles || []).map((p: any) => [p.organization_id, p]));
    return {
      suppliers: (asClient || []).map((l: any) => {
        const p: any = profileOf.get(l.supplier_org_id);
        return {
          ...l,
          supplier_name: p?.display_name || orgName.get(l.supplier_org_id) || 'Fournisseur',
          supplier_number: p?.supplier_number || null,
          delivery_zone: p?.delivery_zone || null,
          default_delivery_fee_cents: p?.default_delivery_fee_cents ?? null,
          default_delivery_currency: p?.default_delivery_currency ?? null,
          takes_orders: !!p && p.active && this.plan.stateOf(p).can_sell,
        };
      }),
      // Who buys from us is for the owner and the managers, not the stock keeper.
      clients: seesClients ? (asSupplier || []).map((l: any) => ({ ...l, client_name: orgName.get(l.client_org_id) || 'Entreprise' })) : [],
    };
  }

  /** A client invites a supplier by its number. Inviting again after a refusal or an end re-opens the invitation. */
  async invite(orgId: string, caller: Caller, input: { supplier_number: string; message?: string }) {
    const { org } = await this.member(orgId, caller);
    const card = await this.lookup(orgId, caller, input.supplier_number);
    const profile = await this.profileOf(card.organization_id);
    this.plan.assertCanSell(profile);
    const { data: existing } = await this.db.from('supplier_links').select('*').eq('client_org_id', orgId).eq('supplier_org_id', card.organization_id).maybeSingle();
    if (existing?.status === 'accepted') throw new BadRequestException(`${card.display_name} est déjà votre fournisseur.`);
    if (existing?.status === 'pending') throw new BadRequestException('Invitation déjà envoyée : en attente de sa réponse.');
    const row = { status: 'pending', message: clean(input.message, 500), invited_by: caller.id, decided_by: null, decided_at: null, created_at: new Date().toISOString() };
    const { data, error } = existing
      ? await this.db.from('supplier_links').update(row).eq('id', existing.id).select().single()
      : await this.db.from('supplier_links').insert({ client_org_id: orgId, supplier_org_id: card.organization_id, ...row }).select().single();
    if (error) this.fail(error);
    await this.notify(await this.supplierRecipients(profile), caller.id, {
      title: 'Nouvelle demande de client',
      body: `${org.name} souhaite vous commander des marchandises. Acceptez-la pour qu'elle voie votre catalogue.`,
      url: '/dashboard/organization/supplier?onglet=clients',
      data: { link_id: data.id },
    });
    return data;
  }

  /**
   * Supplier side: accept or refuse a pending invitation. Either side: end an accepted link (no new orders; those in
   * progress go on). Accepting puts the supplier in the client's list (suppliers.supplier_org_id).
   */
  async decideLink(orgId: string, caller: Caller, linkId: string, action: 'accept' | 'refuse' | 'end') {
    const { data: link, error } = await this.db.from('supplier_links').select('*').eq('id', linkId).maybeSingle();
    if (error) this.fail(error);
    if (!link || (link.client_org_id !== orgId && link.supplier_org_id !== orgId)) throw new NotFoundException('Invitation introuvable');
    const asSupplier = link.supplier_org_id === orgId;
    if (asSupplier) await this.supplierSide(orgId, caller);
    else await this.member(orgId, caller);

    let next: string;
    if (action === 'accept' || action === 'refuse') {
      if (!asSupplier) throw new ForbiddenException("C'est au fournisseur de répondre à l'invitation");
      if (link.status !== 'pending') throw new BadRequestException('Cette invitation a déjà reçu une réponse');
      next = action === 'accept' ? 'accepted' : 'refused';
      if (action === 'accept') this.plan.assertCanSell((await this.profileOf(orgId))!);
    } else if (action === 'end') {
      if (link.status !== 'accepted') throw new BadRequestException("Ce lien n'est pas actif");
      next = 'ended';
    } else {
      throw new BadRequestException('Action inconnue');
    }
    const { data: updated, error: upErr } = await this.db
      .from('supplier_links')
      .update({ status: next, decided_by: caller.id, decided_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('status', link.status)
      .select()
      .maybeSingle();
    if (upErr) this.fail(upErr);
    if (!updated) throw new BadRequestException('Cette invitation vient de changer, actualisez');

    const profile = await this.profileOf(link.supplier_org_id);
    if (next === 'accepted' && profile) await this.addToClientList(link.client_org_id, profile, caller.id);
    const supplierName = profile?.display_name || 'Le fournisseur';
    if (asSupplier) {
      await this.notify(await this.clientRecipients(link.client_org_id, null), caller.id, {
        title: next === 'accepted' ? `${supplierName} a accepté` : next === 'refused' ? `${supplierName} a refusé` : `${supplierName} a mis fin au lien`,
        body: next === 'accepted' ? 'Vous pouvez maintenant voir son catalogue et lui passer commande.' : 'Vous ne pouvez pas lui passer de nouvelle commande.',
        url: '/dashboard/organization/supplier-orders',
      });
    } else if (profile) {
      const client = await this.organizationsService.getOrganizationById(link.client_org_id);
      await this.notify(await this.supplierRecipients(profile), caller.id, {
        title: `${client.name} a mis fin au lien`, body: "Cette entreprise ne vous passera plus de commande (les commandes en cours continuent).",
        url: '/dashboard/organization/supplier?onglet=clients',
      });
    }
    return updated;
  }

  /** The accepted supplier joins the client's own list (linked to an existing entry of the same name, if any). */
  private async addToClientList(clientOrgId: string, profile: any, callerId: string) {
    const { data: linked } = await this.db.from('suppliers').select('id').eq('organization_id', clientOrgId).eq('supplier_org_id', profile.organization_id).is('archived_at', null).maybeSingle();
    if (linked) return;
    const { data: active } = await this.db.from('suppliers').select('id, name').eq('organization_id', clientOrgId).is('archived_at', null);
    const typed = sameName(active || [], profile.display_name);
    if (typed) {
      await this.db.from('suppliers').update({ supplier_org_id: profile.organization_id, updated_at: new Date().toISOString() }).eq('id', typed.id);
      return;
    }
    await this.db.from('suppliers').insert({
      organization_id: clientOrgId, name: profile.display_name, phone: profile.phone, address: profile.address,
      supplier_org_id: profile.organization_id, created_by: callerId,
    });
  }

  /** An accepted link between a client and a supplier, or a refusal. */
  async assertLinked(clientOrgId: string, supplierOrgId: string) {
    const { data } = await this.db.from('supplier_links').select('id').eq('client_org_id', clientOrgId).eq('supplier_org_id', supplierOrgId).eq('status', 'accepted').maybeSingle();
    if (!data) throw new ForbiddenException("Ce fournisseur n'a pas (ou plus) accepté votre entreprise");
  }

  /** Client side: the catalog of a supplier that accepted us (business prices, availability). */
  async supplierCatalog(orgId: string, caller: Caller, supplierOrgId: string) {
    await this.member(orgId, caller, ['gerant', 'magasinier']);
    await this.assertLinked(orgId, supplierOrgId);
    const profile = await this.profileOf(supplierOrgId);
    if (!profile || !profile.active) throw new NotFoundException('Ce fournisseur est fermé');
    const { data: catalog, error } = await this.db.from('supplier_catalog_items').select('*').eq('supplier_org_id', supplierOrgId).eq('active', true);
    if (error) this.fail(error);
    const ids = (catalog || []).map((c: any) => c.stock_item_id);
    const { data: stock } = ids.length
      ? await this.db.from('stock_items').select('id, name, barcode, category, quantity, merchant_id').in('id', ids).eq('merchant_id', profile.merchant_id)
      : { data: [] as any[] };
    const byId = new Map((stock || []).map((s: any) => [s.id, s]));
    const plan = this.plan.stateOf(profile);
    return {
      supplier: {
        organization_id: supplierOrgId, display_name: profile.display_name, supplier_number: profile.supplier_number,
        phone: profile.phone, address: profile.address, delivery_zone: profile.delivery_zone,
        default_delivery_fee_cents: profile.default_delivery_fee_cents, default_delivery_currency: profile.default_delivery_currency,
        takes_orders: plan.can_sell,
      },
      items: (catalog || [])
        .filter((c: any) => byId.has(c.stock_item_id))
        .map((c: any) => {
          const s: any = byId.get(c.stock_item_id);
          return { id: c.id, name: s.name, barcode: s.barcode, category: s.category, price_cents: c.price_cents, currency: c.currency, min_quantity: c.min_quantity, available: s.quantity };
        })
        .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    };
  }
}
