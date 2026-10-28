import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { ProfilePhotosService } from './profile-photos.service';

/** Who may delete their own account: the person who opened it for themselves (migration 082). */
const SELF_DELETABLE_ROLES = ['client', 'merchant', 'enterprise'];
export const DELETION_REASONS = ['not_used', 'technical', 'fees', 'privacy', 'other_account', 'other'] as const;
export type DeletionReason = (typeof DELETION_REASONS)[number];
const BAN_FOREVER = '876000h';

export type DeletionBlocker = { code: string; message: string };

/**
 * A person deletes their own account, from the website (Google Play requires it). Allowed to a client, a merchant
 * (their shop closes) and the owner of an enterprise (the enterprise closes); never to an employee — vendeur/caissier,
 * gérant, magasinier… belong to a business and its owner removes them — nor to an administrator.
 *
 * Money is never touched: while anything is left (balance, savings, a withdrawal on its way, a tontine) the deletion is
 * refused and the person is told what to do first. The money movements stay, without the name (the law requires
 * them); the person's own data is erased and the login is blocked for good.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
    private loginAttempts: LoginAttemptsService,
    private photos: ProfilePhotosService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async roleOf(userId: string): Promise<string> {
    const { data } = await this.db.from('user_roles').select('role:roles(slug)').eq('user_id', userId);
    const slugs = (data || []).map((r: any) => r.role?.slug).filter(Boolean);
    if (slugs.includes('super_admin') || slugs.includes('admin')) return 'admin';
    const other = slugs.find((s: string) => !SELF_DELETABLE_ROLES.includes(s));
    if (other) return other;
    // The widest of what they own decides what closes with the account.
    return ['enterprise', 'merchant', 'client'].find((r) => slugs.includes(r)) ?? 'client';
  }

  /** What stands in the way, in the order to deal with it. Empty = the account can be deleted now. */
  async blockers(userId: string): Promise<{ role: string; blockers: DeletionBlocker[] }> {
    const role = await this.roleOf(userId);
    if (role === 'admin') {
      return { role, blockers: [{ code: 'ADMIN', message: "Un compte administrateur ne se supprime pas ici : un autre super admin doit le retirer." }] };
    }
    const { data: staff } = await this.db.from('organization_staff').select('id, deactivated_at').eq('user_id', userId).maybeSingle();
    if (!SELF_DELETABLE_ROLES.includes(role) || (staff && !staff.deactivated_at)) {
      return {
        role,
        blockers: [{
          code: 'EMPLOYEE',
          message: "Votre compte appartient à l'entreprise ou à la boutique qui vous emploie : seul le patron peut le retirer de son équipe.",
        }],
      };
    }

    const blockers: DeletionBlocker[] = [];

    // Balance: the sum of the ledger, per currency (never changed here).
    const { data: wallet } = await this.db.from('wallets').select('id').eq('user_id', userId).maybeSingle();
    if (wallet) {
      const { data: entries } = await this.db.from('ledger_entries').select('amount_cents, direction, currency').eq('wallet_id', wallet.id);
      const left = { CDF: 0, USD: 0 } as Record<string, number>;
      for (const e of entries || []) left[e.currency === 'USD' ? 'USD' : 'CDF'] += e.direction === 'credit' ? Number(e.amount_cents) : -Number(e.amount_cents);
      if (left.CDF !== 0 || left.USD !== 0) {
        blockers.push({ code: 'BALANCE', message: 'Votre solde doit être à zéro : retirez d\'abord tout votre argent (CDF et USD).' });
      }
      const { data: pending } = await this.db.from('withdrawals').select('id').eq('wallet_id', wallet.id).in('status', ['PENDING', 'PROCESSING']).limit(1);
      if (pending?.length) blockers.push({ code: 'WITHDRAWAL', message: 'Un retrait est encore en cours : attendez qu\'il soit terminé.' });
    }

    const { data: savings } = await this.db.rpc('savings_pot_balances', { p_user_id: userId });
    if (((savings as any[]) || []).some((b) => Number(b.balance_cents) !== 0)) {
      blockers.push({ code: 'SAVINGS', message: 'Votre épargne doit être vide : retirez-la d\'abord vers votre solde, puis retirez votre solde.' });
    }

    const { data: tontines } = await this.db.from('tontine_members').select('status, group:tontine_groups(status)').eq('user_id', userId).eq('status', 'active');
    if ((tontines || []).some((t: any) => ['forming', 'active'].includes(t.group?.status))) {
      blockers.push({ code: 'TONTINE', message: 'Vous participez à une tontine en cours : attendez sa fin ou quittez-la d\'abord.' });
    }

    // An owner's team goes first: their accounts depend on the business.
    if (role === 'merchant') {
      const { data: shops } = await this.db.from('merchants').select('id').eq('owner_id', userId);
      const ids = (shops || []).map((s: any) => s.id);
      if (ids.length) {
        const { data: team } = await this.db.from('merchant_users').select('id').in('merchant_id', ids).neq('user_id', userId).eq('status', 'active').limit(1);
        if (team?.length) blockers.push({ code: 'TEAM', message: 'Retirez d\'abord vos caissiers (Équipe).' });
      }
    }
    if (role === 'enterprise') {
      const { data: orgs } = await this.db.from('organizations').select('id').eq('owner_id', userId);
      const ids = (orgs || []).map((o: any) => o.id);
      if (ids.length) {
        const { data: team } = await this.db.from('organization_staff').select('id').in('organization_id', ids).is('deactivated_at', null).limit(1);
        if (team?.length) blockers.push({ code: 'TEAM', message: 'Désactivez d\'abord tous vos employés (Personnel).' });
      }
    }

    return { role, blockers };
  }

  async deleteAccount(userId: string, input: { password: string; reason: DeletionReason; comment?: string }, ctx: { ip?: string; userAgent?: string } = {}) {
    if (!DELETION_REASONS.includes(input.reason)) throw new BadRequestException('Choisissez la raison de votre départ.');
    await this.assertPassword(userId, input.password);

    const { role, blockers } = await this.blockers(userId);
    if (blockers.length) throw new ForbiddenException({ statusCode: 403, code: 'DELETION_BLOCKED', message: blockers[0].message, blockers });

    const now = new Date().toISOString();
    const anonymousEmail = `supprime-${userId}@supprime.scanlinkpay.invalid`;

    // 1. The login stops working first: whatever fails after, nobody gets back in.
    const { error: banError } = await this.db.auth.admin.updateUserById(userId, {
      ban_duration: BAN_FOREVER,
      email: anonymousEmail,
      email_confirm: true,
      user_metadata: {},
    } as any);
    if (banError) throw new Error(`Failed to block the account: ${banError.message}`);

    // 2. Why they leave (anonymous).
    await this.db.from('account_deletions').insert({ user_id: userId, role, reason: input.reason, comment: input.comment?.trim().slice(0, 1000) || null });

    // 3. The business closes with its owner.
    if (role === 'merchant') await this.db.from('merchants').update({ status: 'closed', updated_at: now }).eq('owner_id', userId);
    if (role === 'enterprise') {
      const { data: orgs } = await this.db.from('organizations').select('id').eq('owner_id', userId);
      const ids = (orgs || []).map((o: any) => o.id);
      if (ids.length) {
        await this.db.from('organizations').update({ status: 'closed', updated_at: now }).in('id', ids);
        await this.db.from('merchants').update({ status: 'closed', updated_at: now }).in('organization_id', ids);
      }
    }

    // 4. Cards, wallet, invitations, devices.
    await this.db.from('cards').update({ status: 'blocked' }).eq('user_id', userId).in('status', ['requested', 'issued', 'active', 'frozen']);
    await this.db.from('wallets').update({ status: 'CLOSED', updated_at: now }).eq('user_id', userId);
    await this.db.from('tontine_members').update({ status: 'declined' }).eq('user_id', userId).eq('status', 'invited');
    await this.db.from('push_subscriptions').delete().eq('user_id', userId);
    await this.db.from('webauthn_credentials').delete().eq('user_id', userId);

    // 5. The person's own data (the photo file first, while the profile still says where it is).
    await this.photos.purgeAvatarOf(userId).catch(() => undefined);
    const { error } = await this.db.from('profiles').update({
      full_name: 'Compte supprimé',
      email: anonymousEmail,
      phone: null,
      avatar_url: null,
      status: 'deleted',
      deleted_at: now,
      transaction_pin_hash: null,
      app_code_hash: null,
      recovery_code_hash: null,
      two_factor_secret: null,
      two_factor_enabled: false,
      active_session_id: null,
      active_device_id: null,
      tokens_valid_after: now,
      updated_at: now,
    }).eq('id', userId);
    if (error) this.logger.error(`Account ${userId} blocked but its profile could not be erased: ${error.message}`);

    await this.auditService.log({
      user_id: userId,
      action: 'account_deleted',
      entity_type: 'profile',
      entity_id: userId,
      changes: { role, reason: input.reason },
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
    });
    return { deleted: true };
  }

  /** The account password, typed again: a session left open on a phone is not enough to delete the account. */
  private async assertPassword(userId: string, password: string) {
    if (!password) throw new BadRequestException('Saisissez votre mot de passe.');
    const key = `account-delete:${userId}`;
    await this.loginAttempts.reserve(key);
    let authEmail = '';
    try {
      const { data } = await this.db.auth.admin.getUserById(userId);
      authEmail = data?.user?.email || '';
    } catch {
      // Falls back to the profile's email below.
    }
    if (!authEmail) {
      const { data: p } = await this.db.from('profiles').select('email').eq('id', userId).maybeSingle();
      authEmail = (p as any)?.email || '';
    }
    const { error } = await this.supabaseService.getAuthClient().auth.signInWithPassword({ email: authEmail, password });
    if (error) throw new ForbiddenException('Mot de passe incorrect.');
    await this.loginAttempts.recordSuccess(key);
  }
}
