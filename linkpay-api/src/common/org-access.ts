import { ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Enterprise staff and their stations.
 *
 * An organization's stores (merchants.organization_id) are its stations, and
 * every staff member works in exactly one (organization_staff.merchant_id).
 * The owner reaches every station; a staff member only theirs. The station
 * is read from the database, not the token, so moving someone to another
 * station (or deactivating them) takes effect on their very next request.
 */
export const ORG_STAFF_ROLES = ['gerant', 'magasinier', 'vendeur', 'caissier', 'comptable'];

/** Till staff see their own tickets and cash sessions only — the station's
 * whole history (and every cashier's counted discrepancies) is for the
 * station manager, the accountant and the owner. */
export const OWN_TILL_ONLY_ROLES = ['caissier', 'vendeur'];

export function isOrgStaffRole(role: string | undefined): boolean {
  return !!role && ORG_STAFF_ROLES.includes(role);
}

/** The station of an active staff member of `orgId`, or null (not staff there, deactivated, or not assigned yet). */
export async function staffStationOf(client: SupabaseClient, userId: string | undefined, orgId: string | undefined): Promise<string | null> {
  if (!userId || !orgId) return null;
  const { data } = await client
    .from('organization_staff')
    .select('merchant_id, deactivated_at')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!data || data.deactivated_at) return null;
  return data.merchant_id || null;
}

/** Active staff of a station holding one of `roles` (e.g. its managers), as user ids. */
export async function stationStaffWithRoles(client: SupabaseClient, merchantId: string, roles: string[]): Promise<string[]> {
  const { data: staff } = await client
    .from('organization_staff')
    .select('user_id')
    .eq('merchant_id', merchantId)
    .is('deactivated_at', null);
  const ids = (staff || []).map((s: any) => s.user_id as string);
  if (!ids.length) return [];
  const { data: userRoles } = await client.from('user_roles').select('user_id, role:roles(slug)').in('user_id', ids);
  return (userRoles || []).filter((r: any) => roles.includes(r.role?.slug)).map((r: any) => r.user_id as string);
}

/** Same as staffStationOf(), but a staff member without a station is refused with a clear message. */
export async function requireStaffStation(client: SupabaseClient, userId: string | undefined, orgId: string | undefined): Promise<string> {
  const station = await staffStationOf(client, userId, orgId);
  if (!station) {
    throw new ForbiddenException("Aucune station ne vous est affectée. Demandez au responsable de l'entreprise de vous affecter à une station.");
  }
  return station;
}
