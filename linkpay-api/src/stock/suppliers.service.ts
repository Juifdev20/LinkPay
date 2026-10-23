import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';

/** Who keeps the supplier list (with the owner): the people who buy and receive the goods. */
export const SUPPLIER_MANAGE_ROLES = ['gerant', 'magasinier'];
/** Who may read it: the same, plus the accountant (purchases are their business too). */
const SUPPLIER_READ_ROLES = [...SUPPLIER_MANAGE_ROLES, 'comptable'];

type Caller = { id: string; role?: string; organization_id?: string };
export type SupplierInput = { name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null };

/** The row whose name is `name`, ignoring case and spaces around it. */
export const sameName = <T extends { name: string }>(rows: T[], name: string): T | null => {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return rows.find((r) => r.name.trim().replace(/\s+/g, ' ').toLowerCase() === key) || null;
};

const clean = (v: string | null | undefined, max: number) => (v == null ? null : v.trim().replace(/\s+/g, ' ').slice(0, max) || null);

/**
 * An enterprise's suppliers (migration 083, DECISIONS.md 23/10), shared by all its stations and every sector. Optional
 * on a product: picked from this list or typed by hand in the product sheet — a typed name joins the list. Archived,
 * never deleted, so products keep showing who supplied them.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private supabaseService: SupabaseService,
    private organizationsService: OrganizationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private isAdmin(role?: string) {
    return role === 'admin' || role === 'super_admin';
  }

  private async assertAccess(orgId: string, caller: Caller, manage: boolean) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    if (this.isAdmin(caller.role) || org.owner_id === caller.id) return org;
    const roles = manage ? SUPPLIER_MANAGE_ROLES : SUPPLIER_READ_ROLES;
    if (caller.organization_id === orgId && roles.includes(caller.role || '')) return org;
    throw new ForbiddenException(manage ? "Seuls le patron, le gérant et le magasinier gèrent les fournisseurs" : "Vous n'avez pas accès aux fournisseurs de cette entreprise");
  }

  private fail(error: { message: string; code?: string }): never {
    if (/suppliers/.test(error.message) && /schema cache|does not exist/.test(error.message)) {
      throw new ServiceUnavailableException("Les fournisseurs n'existent pas encore : appliquez la migration 083_suppliers.sql.");
    }
    if (error.code === '23505') throw new BadRequestException('Un fournisseur porte déjà ce nom.');
    throw new Error(`Suppliers: ${error.message}`);
  }

  /** Active suppliers, A → Z, with how many products point to each. */
  async list(orgId: string, caller: Caller) {
    await this.assertAccess(orgId, caller, false);
    const { data, error } = await this.db
      .from('suppliers')
      .select('*')
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .order('name', { ascending: true });
    if (error) this.fail(error);
    const rows = data || [];
    if (!rows.length) return [];
    const { data: items } = await this.db.from('stock_items').select('supplier_id').in('supplier_id', rows.map((r) => r.id));
    const count = new Map<string, number>();
    for (const i of items || []) count.set(i.supplier_id, (count.get(i.supplier_id) || 0) + 1);
    return rows.map((r) => ({ ...r, product_count: count.get(r.id) || 0 }));
  }

  /**
   * The active supplier of this name ("bralima " = "Bralima"), or null. Compared here, not with a pattern: in a
   * PostgREST pattern '*' and '%' are wildcards, so "Bra*" would have matched "Bralima".
   */
  private async findByName(orgId: string, name: string) {
    const { data, error } = await this.db
      .from('suppliers')
      .select('*')
      .eq('organization_id', orgId)
      .is('archived_at', null);
    if (error) this.fail(error);
    return sameName(data || [], name);
  }

  /** Adds a supplier — or gives back the one already called so (typing the same name twice never makes two). */
  async create(orgId: string, caller: Caller, input: SupplierInput) {
    await this.assertAccess(orgId, caller, true);
    return this.createUnchecked(orgId, caller.id, input);
  }

  private async createUnchecked(orgId: string, callerId: string, input: SupplierInput) {
    const name = clean(input.name, 120);
    if (!name) throw new BadRequestException('Indiquez le nom du fournisseur.');
    const existing = await this.findByName(orgId, name);
    if (existing) return existing;
    const { data, error } = await this.db
      .from('suppliers')
      .insert({
        organization_id: orgId,
        name,
        phone: clean(input.phone, 30),
        email: clean(input.email, 160),
        address: clean(input.address, 255),
        notes: clean(input.notes, 1000),
        created_by: callerId,
      })
      .select()
      .single();
    if (error) {
      // Two people typed the same new name at once: the other one won, use it.
      if (error.code === '23505') {
        const again = await this.findByName(orgId, name);
        if (again) return again;
      }
      this.fail(error);
    }
    return data;
  }

  async update(orgId: string, supplierId: string, caller: Caller, input: SupplierInput) {
    await this.assertAccess(orgId, caller, true);
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) {
      const name = clean(input.name, 120);
      if (!name) throw new BadRequestException('Indiquez le nom du fournisseur.');
      changes.name = name;
    }
    if (input.phone !== undefined) changes.phone = clean(input.phone, 30);
    if (input.email !== undefined) changes.email = clean(input.email, 160);
    if (input.address !== undefined) changes.address = clean(input.address, 255);
    if (input.notes !== undefined) changes.notes = clean(input.notes, 1000);
    const { data, error } = await this.db
      .from('suppliers')
      .update(changes)
      .eq('id', supplierId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .select()
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException('Fournisseur introuvable');
    return data;
  }

  /** Off the list; its products keep their supplier (still shown), nothing else changes. */
  async archive(orgId: string, supplierId: string, caller: Caller) {
    await this.assertAccess(orgId, caller, true);
    const { data, error } = await this.db
      .from('suppliers')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', supplierId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();
    if (error) this.fail(error);
    if (!data) throw new NotFoundException('Fournisseur introuvable');
    return { archived: true };
  }

  /**
   * The supplier a product sheet asks for, as a supplier id: `supplier_id` must belong to the product's enterprise;
   * `supplier_name` (typed by hand) is found or added. `null` clears it; `undefined` leaves it as it is. The caller's
   * right to edit the product was checked already — that right includes naming its supplier.
   */
  async resolveForProduct(orgId: string | null | undefined, callerId: string, input: { supplier_id?: string | null; supplier_name?: string | null }) {
    const typed = input.supplier_name !== undefined ? clean(input.supplier_name, 120) : undefined;
    if (input.supplier_id === undefined && typed === undefined) return undefined;
    if (input.supplier_id === null || (input.supplier_id === undefined && typed === null)) return null;
    if (!orgId) throw new BadRequestException("Cette boutique ne fait partie d'aucune entreprise : pas de fournisseur.");
    if (input.supplier_id) {
      const { data, error } = await this.db.from('suppliers').select('id').eq('id', input.supplier_id).eq('organization_id', orgId).maybeSingle();
      if (error) this.fail(error);
      if (!data) throw new BadRequestException("Ce fournisseur n'appartient pas à cette entreprise.");
      return data.id as string;
    }
    const supplier = await this.createUnchecked(orgId, callerId, { name: typed! });
    return supplier.id as string;
  }

  /** id → name, for showing products' suppliers (archived ones included). */
  async namesByIds(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const { data, error } = await this.db.from('suppliers').select('id, name').in('id', unique);
    if (error) return new Map<string, string>(); // migration 083 not run: products simply show no supplier
    return new Map((data || []).map((s: any) => [s.id as string, s.name as string]));
  }
}
