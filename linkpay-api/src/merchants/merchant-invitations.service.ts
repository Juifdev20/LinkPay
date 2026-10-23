import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeDrcPhone, phoneLikePattern, samePhone } from '../auth/phone';
import { publicHolderName } from '../cards/card-number';

/** "•••• 345 678": enough for the owner to recognise the number they typed, never a full one handed back. */
const maskPhone = (phone?: string | null) => {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-6);
  return d ? `•••• ${d.slice(0, 3)} ${d.slice(3)}` : null;
};

/**
 * A shop owner invites a cashier; the person accepts or refuses in their own app (migration 078). Nothing changes on
 * their account until they accept — before, an invitation by email turned the account into a cashier at once, and by
 * phone anybody could have done it to anybody. The rules of who may become a cashier are checked when inviting AND
 * again when accepting (the account may have changed in between).
 */
@Injectable()
export class MerchantInvitationsService {
  private readonly logger = new Logger(MerchantInvitationsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private notifications: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** The account behind a phone number (any format people type) or an email. */
  private async findAccount(target: { email?: string; phone?: string }) {
    if (target.phone) {
      const phone = normalizeDrcPhone(target.phone);
      if (!phone) throw new BadRequestException('Numéro invalide : +243 suivi de 9 chiffres (ex. 0812345678).');
      const { data } = await this.db.from('profiles').select('id, full_name, phone').like('phone', phoneLikePattern(phone)).limit(10);
      return (data || []).find((p: any) => samePhone(p.phone, phone)) ?? null;
    }
    if (target.email) {
      const { data } = await this.db.from('profiles').select('id, full_name, phone').ilike('email', target.email.trim()).maybeSingle();
      return data ?? null;
    }
    throw new BadRequestException('Indiquez le numéro de téléphone ou l\'email de la personne.');
  }

  /** Only a plain client account, in no shop's team yet, can become a cashier. */
  private async assertCanBecomeCashier(userId: string) {
    const { data: roles } = await this.db.from('user_roles').select('role:roles(slug)').eq('user_id', userId);
    const slugs = (roles || []).map((r: any) => r.role?.slug).filter(Boolean);
    if (slugs.some((slug: string) => slug !== 'client')) {
      throw new BadRequestException(
        'Cette personne a déjà un rôle sur ScanLinkPay (marchand, caissier, entreprise ou administrateur) — seul un compte client peut devenir caissier.',
      );
    }
    const { data: membership } = await this.db.from('merchant_users').select('id').eq('user_id', userId).limit(1);
    if (membership?.length) throw new BadRequestException("Cette personne fait déjà partie de l'équipe d'une boutique.");
  }

  private async merchantName(merchantId: string) {
    const { data } = await this.db.from('merchants').select('name, owner_id').eq('id', merchantId).maybeSingle();
    return data;
  }

  /** Lapsed invitations stop counting (and stop blocking a new one). */
  private async expireOld(filter: { merchant_id?: string; user_id?: string }) {
    let q = this.db.from('merchant_invitations').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', new Date().toISOString());
    if (filter.merchant_id) q = q.eq('merchant_id', filter.merchant_id);
    if (filter.user_id) q = q.eq('user_id', filter.user_id);
    await q;
  }

  async invite(merchantId: string, ownerId: string, target: { email?: string; phone?: string }) {
    const account = await this.findAccount(target);
    if (!account) {
      throw new NotFoundException(
        target.phone
          ? "Aucun compte ScanLinkPay avec ce numéro — la personne doit d'abord créer un compte."
          : "Aucun compte ScanLinkPay avec cet email — la personne doit d'abord créer un compte.",
      );
    }
    if (account.id === ownerId) throw new BadRequestException('Vous ne pouvez pas vous inviter vous-même.');
    await this.assertCanBecomeCashier(account.id);
    await this.expireOld({ merchant_id: merchantId, user_id: account.id });

    const { data: invitation, error } = await this.db
      .from('merchant_invitations')
      .insert({ merchant_id: merchantId, user_id: account.id, invited_by: ownerId })
      .select('id, status, expires_at, created_at')
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new ConflictException('Une invitation attend déjà la réponse de cette personne.');
      throw new Error(`Failed to create invitation: ${error.message}`);
    }

    const shop = await this.merchantName(merchantId);
    await this.notifications.create({
      user_id: account.id,
      type: 'merchant_invitation',
      title: 'Invitation à devenir caissier',
      body: `${shop?.name ?? 'Une boutique'} vous invite à encaisser pour elle. Ouvrez l'application pour accepter ou refuser.`,
      data: { invitation_id: invitation.id, merchant_id: merchantId },
    }).catch((err: any) => this.logger.warn(`Invitation ${invitation.id}: notification failed: ${err.message}`));

    return { ...invitation, invitee: { name: publicHolderName(account.full_name), phone: maskPhone(account.phone) } };
  }

  /** What waits for an answer in this shop (the owner's Équipe screen). */
  async listForMerchant(merchantId: string) {
    await this.expireOld({ merchant_id: merchantId });
    const { data } = await this.db
      .from('merchant_invitations')
      .select('id, status, expires_at, created_at, user_id')
      .eq('merchant_id', merchantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const ids = (data || []).map((i: any) => i.user_id);
    const { data: people } = ids.length ? await this.db.from('profiles').select('id, full_name, phone').in('id', ids) : { data: [] };
    const byId = new Map((people || []).map((p: any) => [p.id, p]));
    return (data || []).map(({ user_id, ...i }: any) => ({
      ...i,
      invitee: { name: publicHolderName(byId.get(user_id)?.full_name), phone: maskPhone(byId.get(user_id)?.phone) },
    }));
  }

  async cancel(merchantId: string, invitationId: string) {
    const { data } = await this.db
      .from('merchant_invitations')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', invitationId)
      .eq('merchant_id', merchantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!data) throw new NotFoundException("Cette invitation n'attend plus de réponse.");
    return { status: 'cancelled' };
  }

  /** The invitations waiting for this person's answer (their home screen). */
  async listForUser(userId: string) {
    await this.expireOld({ user_id: userId });
    const { data } = await this.db
      .from('merchant_invitations')
      .select('id, merchant_id, expires_at, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const ids = [...new Set((data || []).map((i: any) => i.merchant_id))];
    const { data: shops } = ids.length ? await this.db.from('merchants').select('id, name, city').in('id', ids) : { data: [] };
    const byId = new Map((shops || []).map((s: any) => [s.id, s]));
    return (data || []).map((i: any) => ({ ...i, merchant: { name: byId.get(i.merchant_id)?.name ?? 'Boutique', city: byId.get(i.merchant_id)?.city ?? null } }));
  }

  private async claim(userId: string, invitationId: string, status: 'accepted' | 'declined') {
    const { data } = await this.db
      .from('merchant_invitations')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', invitationId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id, merchant_id, invited_by')
      .maybeSingle();
    if (!data) throw new NotFoundException("Cette invitation n'est plus valable (annulée, expirée ou déjà répondue).");
    return data;
  }

  /**
   * Accepted: the person joins the shop's team as cashier, their account role becomes cashier, and a new access
   * token comes back so their app switches to the till without signing in again.
   */
  async accept(userId: string, email: string, sessionId: string | undefined, invitationId: string) {
    const invitation = await this.claim(userId, invitationId, 'accepted');
    try {
      await this.assertCanBecomeCashier(userId);
    } catch (err) {
      // Their account changed since the invitation: it stays unanswered, the reason is shown.
      await this.db.from('merchant_invitations').update({ status: 'pending', responded_at: null }).eq('id', invitationId).eq('status', 'accepted');
      throw err;
    }

    const { data: role } = await this.db.from('roles').select('id').eq('slug', 'cashier').single();
    if (!role) throw new NotFoundException('Role "cashier" not found');
    const { error } = await this.db.from('merchant_users').insert({ merchant_id: invitation.merchant_id, user_id: userId, role_id: role.id, status: 'active' });
    if (error) {
      await this.db.from('merchant_invitations').update({ status: 'pending', responded_at: null }).eq('id', invitationId).eq('status', 'accepted');
      throw new Error(`Failed to add cashier: ${error.message}`);
    }
    // One role at a time (the JWT carries one): replace, never accumulate.
    await this.db.from('user_roles').delete().eq('user_id', userId);
    await this.db.from('user_roles').insert({ user_id: userId, role_id: role.id, merchant_id: invitation.merchant_id });

    const { data: me } = await this.db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    await this.notifications.create({
      user_id: invitation.invited_by,
      type: 'merchant_invitation_accepted',
      title: 'Invitation acceptée',
      body: `${publicHolderName(me?.full_name)} a rejoint votre équipe comme caissier.`,
      data: { invitation_id: invitationId },
    }).catch(() => null);

    const access_token = await this.authService.generateToken(userId, email, 'cashier', invitation.merchant_id, sessionId);
    return { status: 'accepted', merchant_id: invitation.merchant_id, access_token };
  }

  async decline(userId: string, invitationId: string) {
    const invitation = await this.claim(userId, invitationId, 'declined');
    const { data: me } = await this.db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    await this.notifications.create({
      user_id: invitation.invited_by,
      type: 'merchant_invitation_declined',
      title: 'Invitation refusée',
      body: `${publicHolderName(me?.full_name)} a refusé de rejoindre votre équipe.`,
      data: { invitation_id: invitationId },
    }).catch(() => null);
    return { status: 'declined' };
  }
}
