import { Injectable, NotFoundException, ConflictException, GoneException, BadRequestException, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

export const STAFF_ROLE_SLUGS = ['magasinier', 'vendeur', 'caissier', 'comptable'];
/** Effectively permanent: Supabase Auth refuses this account until the patron restores it. */
const BAN_FOREVER = '876000h';

// Excludes visually ambiguous characters (0/O, 1/l/I) — this password is
// read off a printed PDF and typed by hand on a first login.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

@Injectable()
export class OrganizationStaffService {
  private readonly logger = new Logger(OrganizationStaffService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
  ) {}

  private generateTempPassword(length = 10): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    return out;
  }

  /** Enterprise admin creates an account for an employee (Magasinier/
   * Vendeur/Caissier/Comptable/...) — same auth.admin.createUser() shape as
   * AuthService.register(), but admin-triggered on someone else's behalf
   * with a generated temporary password instead of self-service signup.
   * The returned row's temp_password is the ONE time it's ever handed back
   * in full — see getStaffCredential() below for the re-print path, which
   * only works while it hasn't been used yet. */
  async createStaff(orgId: string, creatorId: string, data: {
    nom: string;
    postnom?: string;
    prenom: string;
    telephone?: string;
    email: string;
    role_slug: string;
  }) {
    const { data: role } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', data.role_slug)
      .single();

    if (!role) {
      throw new NotFoundException(`Rôle "${data.role_slug}" introuvable`);
    }

    // Check phone and email up front so the admin gets a readable reason
    // instead of Supabase's raw "already registered" message.
    if (data.telephone) {
      const normalizedPhone = data.telephone.replace(/[^\d]/g, '');
      const { data: phoneTaken } = await this.supabaseService.getClient()
        .from('profiles')
        .select('id, phone')
        .like('phone', `%${normalizedPhone.slice(-9)}`)
        .limit(1);
      if (phoneTaken && phoneTaken.length > 0) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé par un autre compte');
      }
    }

    const { data: emailTaken } = await this.supabaseService.getClient()
      .from('profiles')
      .select('id')
      .ilike('email', data.email)
      .limit(1);
    if (emailTaken && emailTaken.length > 0) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const tempPassword = this.generateTempPassword();
    const fullName = `${data.prenom} ${data.nom}`.trim();

    const { data: created, error: createUserError } = await this.supabaseService.getClient()
      .auth.admin.createUser({
        email: data.email,
        password: tempPassword,
        phone: data.telephone,
        user_metadata: { full_name: fullName, phone: data.telephone },
        email_confirm: true,
      });

    if (createUserError) {
      if (createUserError.message.includes('already')) {
        throw new ConflictException('Un compte existe déjà avec cet email');
      }
      throw new ConflictException(createUserError.message);
    }

    const userId = created.user.id;

    await this.supabaseService.getClient().from('profiles').upsert({
      id: userId,
      email: data.email,
      phone: data.telephone,
      full_name: fullName,
      must_change_password: true,
    }, { onConflict: 'id' });

    // The JWT model only supports one "current" role per user — replace any
    // prior row(s) instead of accumulating (same reasoning as elsewhere,
    // e.g. merchants.service.ts createMerchant()).
    await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', userId);
    await this.supabaseService.getClient().from('user_roles').insert({
      user_id: userId,
      role_id: role.id,
      organization_id: orgId,
    });

    // Their own wallet, where the patron can send their salary and from which they withdraw it.
    await this.supabaseService.getClient().from('wallets').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });

    const { data: staff, error: staffError } = await this.supabaseService.getClient()
      .from('organization_staff')
      .insert({
        organization_id: orgId,
        user_id: userId,
        nom: data.nom,
        postnom: data.postnom || null,
        prenom: data.prenom,
        telephone: data.telephone,
        email: data.email,
        temp_password: tempPassword,
        created_by: creatorId,
      })
      .select()
      .single();

    if (staffError) {
      throw new Error(`Failed to record staff member: ${staffError.message}`);
    }

    return { ...staff, role_slug: data.role_slug };
  }

  /** List for the role-cards screen — never includes temp_password itself,
   * only whether it's still available (has_temp_password), matching the
   * "archived only until first use" rule. organization_staff.user_id and
   * user_roles.user_id both reference auth.users but not each other, so
   * PostgREST can't embed roles directly — join manually, same pattern as
   * MerchantsService.getMerchantUsers(). */
  async listStaff(orgId: string) {
    const { data: staff, error } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch organization staff: ${error.message}`);
    }
    if (!staff?.length) return [];

    const userIds = staff.map((s) => s.user_id);
    const { data: userRoles } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('user_id, role:roles(slug, name)')
      .eq('organization_id', orgId)
      .in('user_id', userIds);

    const roleByUser: Record<string, any> = {};
    (userRoles || []).forEach((ur: any) => { roleByUser[ur.user_id] = ur.role; });

    return staff.map(({ temp_password, pos_pin_hash: _h, pos_pin_attempts: _a, pos_pin_locked_until: _l, ...s }: any) => ({
      ...s,
      has_temp_password: !!temp_password && !s.deactivated_at,
      active: !s.deactivated_at,
      role: roleByUser[s.user_id]?.slug || null,
      role_name: roleByUser[s.user_id]?.name || null,
    }));
  }

  /** Re-print — only works while the original temp password has never been
   * used (AuthService.changePassword() nulls it out on first successful
   * change). Once gone, it's gone; no regeneration here by design. */
  async getStaffCredential(orgId: string, staffId: string) {
    const { data: staff, error } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('nom, postnom, prenom, email, temp_password')
      .eq('id', staffId)
      .eq('organization_id', orgId)
      .single();

    if (error || !staff) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (!staff.temp_password) {
      throw new GoneException('Ce mot de passe temporaire a déjà été utilisé et changé par l\'utilisateur');
    }

    return staff;
  }

  /** Owner-initiated reset for a staff member who forgot their password —
   * the once-only reprint above can't help there (it's already been used).
   * Mints a fresh temp password in Supabase Auth, re-arms the forced
   * first-login change, and frees the single-session slot + till PIN so the
   * account is recoverable even if the old device is lost. Returns the same
   * credential shape as getStaffCredential() for the PDF re-print. */
  async resetStaffPassword(orgId: string, staffId: string) {
    const { data: staff, error } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('id, user_id, nom, postnom, prenom, email')
      .eq('id', staffId)
      .eq('organization_id', orgId)
      .single();

    if (error || !staff) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const tempPassword = this.generateTempPassword();
    const { error: authError } = await this.supabaseService.getClient()
      .auth.admin.updateUserById(staff.user_id, { password: tempPassword });

    if (authError) {
      throw new Error(`Failed to reset staff password: ${authError.message}`);
    }

    await this.supabaseService.getClient()
      .from('organization_staff')
      .update({ temp_password: tempPassword })
      .eq('id', staffId);

    await this.supabaseService.getClient()
      .from('profiles')
      .update({
        must_change_password: true,
        // New credentials must not let the old device's session ride along
        // — clearing the slot also unblocks login from a different device.
        active_session_id: null,
        active_device_id: null,
      })
      .eq('id', staff.user_id);

    return staff ? { ...staff, temp_password: tempPassword } : staff;
  }

  private async getStaffRow(orgId: string, staffId: string) {
    const { data: staff, error } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('*')
      .eq('id', staffId)
      .eq('organization_id', orgId)
      .single();
    if (error || !staff) throw new NotFoundException('Utilisateur introuvable');
    return staff;
  }

  /** Ends every session of this account at once: the API refuses their tokens as soon as the slot is empty. */
  private async cutSessions(userId: string) {
    await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: null, active_device_id: null })
      .eq('id', userId);
  }

  /**
   * Changes an employee's job (vendeur → caissier…). The role lives in
   * user_roles and travels inside the login token, so the sessions are cut:
   * they log in again and get the screens of the new role.
   */
  async changeStaffRole(orgId: string, staffId: string, ownerId: string, newRoleSlug: string) {
    if (!STAFF_ROLE_SLUGS.includes(newRoleSlug)) throw new BadRequestException('Rôle invalide');
    const staff = await this.getStaffRow(orgId, staffId);
    if (staff.deactivated_at) throw new BadRequestException("L'accès de cet utilisateur est retiré : rétablissez-le d'abord.");

    const client = this.supabaseService.getClient();
    const { data: newRole } = await client.from('roles').select('id, name').eq('slug', newRoleSlug).single();
    if (!newRole) throw new NotFoundException(`Rôle "${newRoleSlug}" introuvable`);

    const { data: current } = await client
      .from('user_roles')
      .select('role:roles(slug, name)')
      .eq('user_id', staff.user_id)
      .eq('organization_id', orgId)
      .maybeSingle();
    const oldRole = (current as any)?.role;
    if (oldRole?.slug === newRoleSlug) throw new BadRequestException('Cet utilisateur a déjà ce rôle');

    // One current role per user (see createStaff).
    await client.from('user_roles').delete().eq('user_id', staff.user_id);
    const { error } = await client.from('user_roles').insert({ user_id: staff.user_id, role_id: newRole.id, organization_id: orgId });
    if (error) throw new Error(`Failed to change role: ${error.message}`);

    await this.cutSessions(staff.user_id);
    await this.auditService.log({
      user_id: ownerId,
      action: 'staff_role_changed',
      entity_type: 'organization_staff',
      entity_id: staffId,
      changes: { employee: [staff.prenom, staff.nom].filter(Boolean).join(' '), from: oldRole?.slug || null, to: newRoleSlug },
    });
    await this.notificationsService.create({
      user_id: staff.user_id,
      type: 'security',
      title: 'Votre rôle a changé',
      body: `Votre rôle est maintenant « ${newRole.name} ». Reconnectez-vous pour voir vos nouveaux écrans.`,
    });
    return { success: true, role: newRoleSlug };
  }

  /**
   * An employee leaves: their login is blocked in Supabase Auth, their
   * sessions are cut on the spot (a token still in their pocket is refused at
   * the next request), and the unused temporary password is erased. Nothing they
   * created is deleted; the journal keeps the trace.
   * The block happens first and does not depend on migration 051.
   */
  async deactivateStaff(orgId: string, staffId: string, ownerId: string) {
    const staff = await this.getStaffRow(orgId, staffId);
    const client = this.supabaseService.getClient();

    const { error: banError } = await client.auth.admin.updateUserById(staff.user_id, { ban_duration: BAN_FOREVER } as any);
    if (banError) throw new Error(`Failed to block the account: ${banError.message}`);
    await this.cutSessions(staff.user_id);

    const { error: markError } = await client
      .from('organization_staff')
      .update({ deactivated_at: new Date().toISOString(), deactivated_by: ownerId, temp_password: null })
      .eq('id', staffId);
    if (markError) this.logger.warn(`Account blocked but could not be marked (apply migration 051): ${markError.message}`);
    // Their till PIN stops working too (it could otherwise still authorize a colleague's voids).
    await client.from('organization_staff').update({ pos_pin_hash: null, pos_pin_attempts: 0, pos_pin_locked_until: null }).eq('id', staffId);

    await this.auditService.log({
      user_id: ownerId,
      action: 'staff_access_removed',
      entity_type: 'organization_staff',
      entity_id: staffId,
      changes: { employee: [staff.prenom, staff.nom].filter(Boolean).join(' '), email: staff.email },
    });
    return { success: true };
  }

  /** Gives access back (an employee returns): unblocks the account and issues a new temporary password. */
  async reactivateStaff(orgId: string, staffId: string, ownerId: string) {
    const staff = await this.getStaffRow(orgId, staffId);
    const client = this.supabaseService.getClient();

    const tempPassword = this.generateTempPassword();
    const { error } = await client.auth.admin.updateUserById(staff.user_id, { ban_duration: 'none', password: tempPassword } as any);
    if (error) throw new Error(`Failed to restore the account: ${error.message}`);

    await client.from('organization_staff')
      .update({ deactivated_at: null, deactivated_by: null, temp_password: tempPassword })
      .eq('id', staffId);
    await client.from('profiles')
      .update({ must_change_password: true, active_session_id: null, active_device_id: null })
      .eq('id', staff.user_id);

    await this.auditService.log({
      user_id: ownerId,
      action: 'staff_access_restored',
      entity_type: 'organization_staff',
      entity_id: staffId,
      changes: { employee: [staff.prenom, staff.nom].filter(Boolean).join(' '), email: staff.email },
    });
    // The temporary password is the point of this call; the till-PIN hash and its counters are not for any screen.
    const { pos_pin_hash: _h, pos_pin_attempts: _a, pos_pin_locked_until: _l, ...safe } = staff as any;
    return { ...safe, temp_password: tempPassword };
  }
}
