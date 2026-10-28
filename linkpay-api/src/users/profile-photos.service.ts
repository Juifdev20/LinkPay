import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { assertCanHavePersonalPhoto, avatarObjectPath, LOGO_MANAGER_STAFF_ROLES, shrinkPhoto, type PhotoKind } from './profile-photos.rules';

const BUCKET = 'avatars';

/**
 * Profile photos (clients, merchants) and company logos (enterprises). The app shrinks the picture before sending it and
 * `shrinkPhoto` shrinks it again here, so what is kept never depends on the client: a small WebP under a random name
 * (a new name at each change, so every screen and the offline cache pick the new picture up at once). The previous file
 * is deleted. The logo is changed only by the owner and the gérants of the company, never by the other staff.
 */
@Injectable()
export class ProfilePhotosService {
  private readonly logger = new Logger(ProfilePhotosService.name);

  constructor(private supabaseService: SupabaseService, private audit: AuditService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async store(folder: string, kind: PhotoKind, file: Buffer | undefined): Promise<string> {
    const webp = await shrinkPhoto(file, kind);
    const path = `${folder}/${randomBytes(16).toString('hex')}.webp`;
    const { error } = await this.db.storage.from(BUCKET).upload(path, webp, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      this.logger.error(`Photo upload failed (${folder}): ${error.message}`);
      throw new InternalServerErrorException("La photo n'a pas pu être enregistrée. Réessayez dans un instant.");
    }
    return this.db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /** Best effort: a file left behind costs a few kilobytes, never an error for the person. */
  private async discard(url?: string | null) {
    const path = avatarObjectPath(url);
    if (!path) return;
    const { error } = await this.db.storage.from(BUCKET).remove([path]);
    if (error) this.logger.warn(`Old photo ${path} not deleted: ${error.message}`);
  }

  // ---------------------------------------------------------------- personal photo
  async setAvatar(userId: string, role: string | undefined, file: Buffer | undefined) {
    assertCanHavePersonalPhoto(role);
    const { data: before } = await this.db.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();
    const url = await this.store(`users/${userId}`, 'avatar', file);
    const { error } = await this.db.from('profiles').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) {
      await this.discard(url);
      throw new InternalServerErrorException("La photo n'a pas pu être enregistrée. Réessayez dans un instant.");
    }
    await this.discard((before as any)?.avatar_url);
    return { avatar_url: url };
  }

  async removeAvatar(userId: string, role: string | undefined) {
    assertCanHavePersonalPhoto(role);
    const { data: before } = await this.db.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();
    await this.db.from('profiles').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', userId);
    await this.discard((before as any)?.avatar_url);
    return { avatar_url: null };
  }

  // ---------------------------------------------------------------- company logo
  /** The owner of the company, or an active gérant of it. Anyone else is refused, with the reason. */
  private async assertLogoManager(orgId: string, callerId: string, callerRole: string | undefined, callerOrgId: string | undefined) {
    const { data: org } = await this.db.from('organizations').select('id, owner_id, logo_url').eq('id', orgId).maybeSingle();
    if (!org) throw new NotFoundException('Entreprise introuvable.');
    if ((org as any).owner_id === callerId) return org as { id: string; owner_id: string; logo_url: string | null };
    if (callerRole && LOGO_MANAGER_STAFF_ROLES.includes(callerRole) && callerOrgId === orgId) {
      const { data: staff } = await this.db.from('organization_staff').select('deactivated_at')
        .eq('user_id', callerId).eq('organization_id', orgId).maybeSingle();
      if (staff && !(staff as any).deactivated_at) return org as { id: string; owner_id: string; logo_url: string | null };
    }
    throw new ForbiddenException("Seul le responsable de l'entreprise (propriétaire ou gérant) peut changer le logo.");
  }

  async setLogo(orgId: string, callerId: string, callerRole: string | undefined, callerOrgId: string | undefined, file: Buffer | undefined) {
    const org = await this.assertLogoManager(orgId, callerId, callerRole, callerOrgId);
    const url = await this.store(`orgs/${orgId}`, 'logo', file);
    const { error } = await this.db.from('organizations').update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', orgId);
    if (error) {
      await this.discard(url);
      this.logger.error(`Logo not saved (is migration 089 applied?): ${error.message}`);
      throw new InternalServerErrorException("Le logo n'a pas pu être enregistré. Réessayez dans un instant.");
    }
    await this.discard(org.logo_url);
    await this.audit.log({ user_id: callerId, action: 'organization_logo_changed', entity_type: 'organization', entity_id: orgId, changes: { logo_url: url } });
    return { logo_url: url };
  }

  async removeLogo(orgId: string, callerId: string, callerRole: string | undefined, callerOrgId: string | undefined) {
    const org = await this.assertLogoManager(orgId, callerId, callerRole, callerOrgId);
    await this.db.from('organizations').update({ logo_url: null, updated_at: new Date().toISOString() }).eq('id', orgId);
    await this.discard(org.logo_url);
    await this.audit.log({ user_id: callerId, action: 'organization_logo_removed', entity_type: 'organization', entity_id: orgId });
    return { logo_url: null };
  }

  /** Account deletion: the photo goes with the person. */
  async purgeAvatarOf(userId: string) {
    const { data } = await this.db.from('profiles').select('avatar_url').eq('id', userId).maybeSingle();
    await this.discard((data as any)?.avatar_url);
  }
}
