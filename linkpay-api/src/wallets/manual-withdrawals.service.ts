import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { AuditService } from '../audit/audit.service';
import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { JobLockService } from '../common/job-lock/job-lock.service';
import { SecurityAlertsService } from '../security/security-alerts.service';

const MAX_REFERENCE = 80;
const MAX_REASON = 300;
/** A withdrawal waiting longer than this is reminded to the administrators, every hour; after URGENT it is critical (SMS + e-mail). */
const OVERDUE_MS = 2 * 3_600_000;
const URGENT_MS = 6 * 3_600_000;

/**
 * Withdrawals that wait for an admin, because the payment provider has no API to send money out (FlexPaie).
 *
 * The wallet was already debited when the person asked (request_withdrawal, atomic). The admin sends the money by hand
 * and then either
 *   - marks it SENT      -> finish_withdrawal (SUCCESS, the fee stays with us), or
 *   - REJECTS it         -> fail_withdrawal (REVERSED: amount AND fee go back to the wallet).
 * Both are atomic and idempotent (migration 042): two admins clicking at once settle it once. Each decision is audited,
 * and an admin can never settle a withdrawal of their own wallet.
 */
@Injectable()
export class ManualWithdrawalsService {
  constructor(
    private supabase: SupabaseService,
    private pspFactory: PspFactory,
    private payouts: WithdrawalPayoutService,
    private audit: AuditService,
    @Optional() private alerts?: SecurityAlertsService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  private readonly logger = new Logger(ManualWithdrawalsService.name);

  private get db() {
    return this.supabase.getClient();
  }

  private isManual(w: { psp_provider?: string | null }): boolean {
    try {
      return this.pspFactory.get(w.psp_provider || undefined).supportsPayout === false;
    } catch {
      return false;
    }
  }

  /** `open` = waiting for the admin, `done` = the last decisions. Only withdrawals that are settled by hand. */
  async list(filter: 'open' | 'done' = 'open', limit = 50) {
    const q = this.db.from('withdrawals').select('*').order('created_at', { ascending: filter === 'open' }).limit(Math.min(Math.max(limit, 1), 100));
    const { data, error } = filter === 'open' ? await q.eq('status', 'PENDING') : await q.in('status', ['SUCCESS', 'REVERSED']);
    if (error) throw new Error(`Failed to list withdrawals: ${error.message}`);
    const rows = (data || []).filter((w: any) => this.isManual(w));

    const walletIds = [...new Set(rows.map((w: any) => w.wallet_id))];
    const owners = new Map<string, any>();
    if (walletIds.length) {
      const { data: wallets } = await this.db.from('wallets').select('id, user_id, wallet_number').in('id', walletIds);
      const userIds = [...new Set((wallets || []).map((w: any) => w.user_id))];
      const { data: profiles } = userIds.length ? await this.db.from('profiles').select('id, full_name, email, phone').in('id', userIds) : { data: [] as any[] };
      const byUser = new Map((profiles || []).map((p: any) => [p.id, p]));
      for (const w of wallets || []) owners.set(w.id, { wallet_number: w.wallet_number, ...(byUser.get(w.user_id) || {}) });
    }

    return {
      data: rows.map((w: any) => ({
        id: w.id,
        status: w.status,
        amount_cents: Number(w.amount_cents),
        fee_cents: Number(w.fee_cents),
        currency: w.currency,
        channel: w.channel,
        destination: w.destination,
        failure_reason: w.failure_reason ?? null,
        psp_reference: w.psp_reference ?? null,
        created_at: w.created_at,
        updated_at: w.updated_at,
        owner: owners.get(w.wallet_id) ? { name: owners.get(w.wallet_id).full_name ?? null, email: owners.get(w.wallet_id).email ?? null, phone: owners.get(w.wallet_id).phone ?? null, wallet_number: owners.get(w.wallet_id).wallet_number ?? null } : null,
      })),
    };
  }

  /** Number of withdrawals waiting for an admin (the badge in the menu). */
  async openCount(): Promise<{ open: number }> {
    const { data, error } = await this.db.from('withdrawals').select('id, psp_provider').eq('status', 'PENDING').limit(500);
    if (error) throw new Error(`Failed to count withdrawals: ${error.message}`);
    return { open: (data || []).filter((w: any) => this.isManual(w)).length };
  }

  /**
   * Hourly: withdrawals nobody has settled for more than 2 hours are reminded to the administrators. A person who asked
   * to withdraw money is waiting; after 6 hours the reminder is critical (SMS and e-mail too).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async remindOverdue(now: number = Date.now()): Promise<number> {
    if (this.jobLock && !(await this.jobLock.acquire('manual-withdrawal-reminder', 300))) return 0;
    try {
      const { data, error } = await this.db
        .from('withdrawals').select('id, created_at, psp_provider').eq('status', 'PENDING')
        .lt('created_at', new Date(now - OVERDUE_MS).toISOString()).order('created_at', { ascending: true }).limit(200);
      if (error) {
        this.logger.error(`Could not look for overdue withdrawals: ${error.message}`);
        return 0;
      }
      const overdue = (data || []).filter((w: any) => this.isManual(w));
      if (overdue.length === 0) return 0;
      const hours = Math.floor((now - new Date(overdue[0].created_at).getTime()) / 3_600_000);
      const urgent = now - new Date(overdue[0].created_at).getTime() >= URGENT_MS;
      void this.alerts?.alert({
        severity: urgent ? 'critical' : 'warning',
        audience: 'admins',
        title: overdue.length === 1 ? 'Un retrait attend depuis plus de 2 h' : `${overdue.length} retraits attendent depuis plus de 2 h`,
        body: `Le plus ancien attend depuis ${hours} h. Administration → Retraits à traiter.`,
        dedupeKey: `withdrawal-overdue:${Math.floor(now / 3_600_000)}`,
        data: { kind: 'manual_withdrawal_overdue', count: overdue.length },
      });
      return overdue.length;
    } catch (err: any) {
      this.logger.error(`Overdue withdrawal reminder failed: ${err?.message}`);
      return 0;
    }
  }

  private async load(id: string, adminId: string) {
    const { data: w } = await this.db.from('withdrawals').select('*').eq('id', id).maybeSingle();
    if (!w) throw new NotFoundException('Retrait introuvable.');
    if (!this.isManual(w)) throw new BadRequestException("Ce retrait n'est pas traité à la main : le prestataire s'en charge.");
    const { data: wallet } = await this.db.from('wallets').select('user_id').eq('id', w.wallet_id).maybeSingle();
    if (wallet?.user_id && wallet.user_id === adminId) {
      throw new ForbiddenException('Vous ne pouvez pas traiter votre propre retrait.');
    }
    return w;
  }

  async markSent(adminId: string, id: string, reference?: string) {
    const w = await this.load(id, adminId);
    if (w.status !== 'PENDING') throw new BadRequestException(`Ce retrait est déjà ${w.status === 'SUCCESS' ? 'marqué comme envoyé' : 'traité'}.`);
    const ref = reference?.trim() ? reference.trim().slice(0, MAX_REFERENCE) : undefined;
    const settled = await this.payouts.apply(id, { status: 'SUCCESS', psp_reference: ref });
    await this.audit.log({
      user_id: adminId, action: 'withdrawal_manual_sent', entity_type: 'withdrawal', entity_id: id,
      changes: { amount_cents: Number(w.amount_cents), currency: w.currency, reference: ref ?? null },
    });
    return { withdrawal: settled };
  }

  async reject(adminId: string, id: string, reason: string) {
    const w = await this.load(id, adminId);
    if (w.status !== 'PENDING') throw new BadRequestException(`Ce retrait est déjà ${w.status === 'SUCCESS' ? 'marqué comme envoyé' : 'traité'}.`);
    const why = (reason || '').trim().slice(0, MAX_REASON);
    if (why.length < 3) throw new BadRequestException('Indiquez la raison du refus.');
    const settled = await this.payouts.apply(id, { status: 'FAILED', reason: why });
    await this.audit.log({
      user_id: adminId, action: 'withdrawal_manual_rejected', entity_type: 'withdrawal', entity_id: id,
      changes: { amount_cents: Number(w.amount_cents), currency: w.currency, reason: why },
    });
    return { withdrawal: settled };
  }
}
