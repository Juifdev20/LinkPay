import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { stationStaffWithRoles } from '../common/org-access';
import { trustedNow } from '../common/utils/trusted-clock';
import { businessDayKey } from '../common/utils/business-day';
import { CASH_WRITE_ROLES } from './cash-roles';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const MIN_REASON = 10;

/** A secret that is too easy to guess: all the same character, a straight run (123456, abcdef) or a very common one. */
export function isTrivialSecret(secret: string): boolean {
  if (/^(.)\1+$/.test(secret)) return true;
  const run = (s: string) => s.split('').every((c, i, a) => i === 0 || c.charCodeAt(0) === a[i - 1].charCodeAt(0) + 1);
  const runDown = (s: string) => s.split('').every((c, i, a) => i === 0 || c.charCodeAt(0) === a[i - 1].charCodeAt(0) - 1);
  if (run(secret) || runDown(secret)) return true;
  return ['password', 'motdepasse', 'azerty', 'qwerty', '000000', '111111', '123456', '654321'].includes(secret.toLowerCase());
}

/**
 * Emergency unlock of a closed day. The seller / cashier sets a personal secret code (mandatory before the first closing);
 * to unlock the day they must give it again each time, plus a reason. Everything — code created, wrong code, lock-out,
 * unlock — is written to cash_unlock_events with the exact date and time. Bookkeeping only: no money moves.
 */
@Injectable()
export class CashUnlockService {
  private readonly logger = new Logger(CashUnlockService.name);

  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async nameOf(userId: string): Promise<string> {
    const { data } = await this.db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
    return data?.full_name || data?.email || '';
  }

  private async record(event: { organization_id?: string | null; merchant_id?: string | null; closing_id?: string | null; business_day?: string | null; currency?: string | null; user_id: string; action: string; reason?: string | null }) {
    const user_name = await this.nameOf(event.user_id).catch(() => '');
    const { error } = await this.db.from('cash_unlock_events').insert({ ...event, user_name, created_at: trustedNow().toISOString() });
    if (error) this.logger.error(`Unlock event not recorded: ${error.message}`);
  }

  // ------------------------------------------------------------------ the secret code

  async status(userId: string): Promise<{ is_set: boolean; locked_until: string | null }> {
    const { data } = await this.db.from('cash_unlock_secrets').select('locked_until').eq('user_id', userId).maybeSingle();
    const locked = data?.locked_until && new Date(data.locked_until) > trustedNow() ? data.locked_until : null;
    return { is_set: !!data, locked_until: locked };
  }

  async hasSecret(userId: string): Promise<boolean> {
    return (await this.status(userId)).is_set;
  }

  /** Creates the code, or changes it (the current one is then required). */
  async setSecret(userId: string, input: { secret: string; confirm: string; current?: string }, merchantId?: string) {
    const secret = (input.secret || '').trim();
    if (secret.length < 6) throw new BadRequestException('Le code secret doit contenir au moins 6 caractères.');
    if (secret.length > 64) throw new BadRequestException('Le code secret est trop long.');
    if (secret !== (input.confirm || '').trim()) throw new BadRequestException('La confirmation ne correspond pas au code.');
    if (isTrivialSecret(secret)) throw new BadRequestException('Ce code est trop facile à deviner : évitez 123456, 000000 ou une suite.');

    const { data: existing } = await this.db.from('cash_unlock_secrets').select('secret_hash, attempts, locked_until').eq('user_id', userId).maybeSingle();
    if (existing) {
      if (!input.current) throw new BadRequestException('Saisissez votre code actuel pour le changer.');
      await this.checkSecret(userId, input.current, existing, { merchant_id: merchantId });
    }
    const hash = await bcrypt.hash(secret, 10);
    const now = trustedNow().toISOString();
    const { error } = await this.db.from('cash_unlock_secrets').upsert({ user_id: userId, secret_hash: hash, attempts: 0, locked_until: null, updated_at: now }, { onConflict: 'user_id' });
    if (error) throw new Error(`Failed to save the unlock code: ${error.message}`);
    await this.record({ user_id: userId, merchant_id: merchantId || null, action: existing ? 'secret_changed' : 'secret_set' });
    await this.auditService.log({ user_id: userId, action: existing ? 'cash_unlock_secret_changed' : 'cash_unlock_secret_set', entity_type: 'user', entity_id: userId }).catch(() => undefined);
    return { is_set: true };
  }

  /** Compares the code; 5 wrong ones lock the unlocking for 15 minutes. Every failure is recorded. */
  private async checkSecret(userId: string, secret: string, row: { secret_hash: string; attempts: number; locked_until: string | null }, ctx: { merchant_id?: string; organization_id?: string; closing_id?: string; business_day?: string; currency?: string }) {
    if (row.locked_until && new Date(row.locked_until) > trustedNow()) {
      const minutes = Math.ceil((new Date(row.locked_until).getTime() - trustedNow().getTime()) / 60000);
      await this.record({ ...ctx, user_id: userId, action: 'blocked' });
      throw new ForbiddenException(`Trop d’essais : le déverrouillage est bloqué encore ${minutes} minute(s).`);
    }
    if (await bcrypt.compare(secret || '', row.secret_hash)) {
      if (row.attempts) await this.db.from('cash_unlock_secrets').update({ attempts: 0, locked_until: null }).eq('user_id', userId);
      return;
    }
    const attempts = (row.attempts || 0) + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await this.db.from('cash_unlock_secrets').update({
      attempts: lock ? 0 : attempts,
      locked_until: lock ? new Date(trustedNow().getTime() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
    }).eq('user_id', userId);
    await this.record({ ...ctx, user_id: userId, action: lock ? 'blocked' : 'failed_attempt' });
    throw new ForbiddenException(lock
      ? `Trop d’essais : le déverrouillage est bloqué pendant ${LOCKOUT_MINUTES} minutes.`
      : `Code secret incorrect (${MAX_ATTEMPTS - attempts} essai(s) restant(s)).`);
  }

  // ------------------------------------------------------------------ unlocking a day

  async unlockDay(merchantId: string, closingId: string, input: { secret: string; reason: string }, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const merchant = await this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, CASH_WRITE_ROLES);
    const reason = (input.reason || '').trim();
    if (reason.length < MIN_REASON) throw new BadRequestException(`Indiquez le motif de l’urgence (${MIN_REASON} caractères minimum).`);

    const { data: secretRow } = await this.db.from('cash_unlock_secrets').select('secret_hash, attempts, locked_until').eq('user_id', callerId).maybeSingle();
    if (!secretRow) throw new BadRequestException('Vous n’avez pas encore de code secret de déverrouillage : créez-le d’abord.');

    const { data: row } = await this.db.from('cash_day_closings').select('*').eq('id', closingId).eq('merchant_id', merchantId).maybeSingle();
    if (!row) throw new NotFoundException('Clôture introuvable.');
    const ctx = { organization_id: merchant.organization_id, merchant_id: merchantId, closing_id: closingId, business_day: row.business_day, currency: row.currency };
    if (row.status !== 'closed') throw new BadRequestException('Cette journée n’est pas verrouillée.');
    if (row.business_day !== businessDayKey(trustedNow())) {
      throw new BadRequestException('Seule la journée en cours peut être déverrouillée en urgence : demandez au gérant ou au patron de rouvrir une journée passée.');
    }

    await this.checkSecret(callerId, input.secret, secretRow, ctx);

    const { data: saved, error } = await this.db.from('cash_day_closings')
      .update({ status: 'reopened', reopened_by: callerId, reopened_at: trustedNow().toISOString(), reopen_reason: `Urgence : ${reason}` })
      .eq('id', closingId).eq('status', 'closed').select().maybeSingle();
    if (error) throw new Error(`Failed to unlock the day: ${error.message}`);
    if (!saved) throw new ConflictException('Cette journée vient déjà d’être déverrouillée.');

    await this.record({ ...ctx, user_id: callerId, action: 'unlock', reason });
    await this.auditService.log({
      user_id: callerId, action: 'cash_day_unlocked', entity_type: 'cash_day_closing', entity_id: closingId,
      changes: { merchant_id: merchantId, day: row.business_day, currency: row.currency, reason },
    }).catch(() => undefined);
    await this.notifyManagers(merchant, row, callerId, reason).catch((err) => this.logger.warn(`Unlock notice not sent: ${err?.message || err}`));
    return saved;
  }

  private async notifyManagers(merchant: any, closing: any, callerId: string, reason: string) {
    const { data: org } = merchant.organization_id
      ? await this.db.from('organizations').select('owner_id').eq('id', merchant.organization_id).maybeSingle()
      : { data: null };
    const managers = await stationStaffWithRoles(this.db, merchant.id, ['gerant']);
    const recipients = [...new Set([org?.owner_id || merchant.owner_id, ...managers].filter(Boolean))].filter((id) => id !== callerId) as string[];
    const who = await this.nameOf(callerId);
    await Promise.all(recipients.map((userId) => this.notificationsService.create({
      user_id: userId, type: 'cash_day_unlocked', title: 'Caisse déverrouillée en urgence',
      body: `${merchant.name} · ${closing.business_day} : ${who || 'un vendeur'} a déverrouillé la caisse clôturée. Motif : ${reason}`,
      data: { merchant_id: merchant.id, day: closing.business_day, currency: closing.currency },
    }).catch(() => undefined)));
  }

  // ------------------------------------------------------------------ history

  /** Newest first. The seller sees their own events; the manager, the owner and the accountant see the station's. */
  async listEvents(merchantId: string, from: string | undefined, to: string | undefined, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const merchant = await this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, [...CASH_WRITE_ROLES, 'comptable']);
    const sees = merchant.owner_id === callerId || ['gerant', 'comptable', 'enterprise', 'admin', 'super_admin'].includes(callerRole);
    let q = this.db.from('cash_unlock_events').select('*').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(300);
    if (!sees) q = q.eq('user_id', callerId);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lt('created_at', to);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to list unlock events: ${error.message}`);
    return data || [];
  }
}
