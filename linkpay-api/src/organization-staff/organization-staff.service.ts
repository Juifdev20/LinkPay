import { Injectable, NotFoundException, ConflictException, GoneException, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';

// Excludes visually ambiguous characters (0/O, 1/l/I) — this password is
// read off a printed PDF and typed by hand on a first login.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

@Injectable()
export class OrganizationStaffService {
  private readonly logger = new Logger(OrganizationStaffService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
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
      .select('id, user_id, nom, postnom, prenom, telephone, email, temp_password, created_at')
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

    return staff.map(({ temp_password, ...s }) => ({
      ...s,
      has_temp_password: !!temp_password,
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
}
