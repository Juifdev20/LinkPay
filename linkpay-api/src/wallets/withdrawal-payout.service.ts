import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { PayoutNotSentError, PayoutRetryLaterError, isManualPayout } from '../payments/psp/psp.adapter';
import { JobLockService } from '../common/job-lock/job-lock.service';
import { SecurityAlertsService } from '../security/security-alerts.service';

const RECONCILE_BATCH_SIZE = 50;
// A withdrawal is looked at again only once it has been open this long, so
// the job doesn't race the request that is still talking to the provider.
const RECONCILE_MIN_AGE_MS = 60_000;
// If the provider has no trace of a payout we sent to it, that may just be a
// delay on their side: only after this long do we conclude it never left.
const NOT_SENT_GRACE_MS = 10 * 60_000;

export type PayoutOutcome =
  | { status: 'SUCCESS'; psp_reference?: string }
  | { status: 'PENDING'; psp_reference?: string }
  | { status: 'FAILED'; reason: string };

/**
 * Sends a withdrawal's money out through the payment provider and settles the
 * result. The wallet was already debited when the withdrawal was created;
 * from there a withdrawal ends in exactly one of two ways:
 *   - the provider confirms the money was sent  -> SUCCESS
 *   - the provider confirms it was NOT sent      -> REVERSED (wallet refunded)
 * and in between it stays open (PENDING / PROCESSING). The rule that keeps
 * this safe: the wallet is refunded only on a CONFIRMED failure — never
 * because of a timeout or a dropped connection, since the payout may have
 * gone through and refunding would pay the money twice.
 *
 * The state changes themselves (finish_withdrawal / fail_withdrawal, migration
 * 042) are atomic and idempotent, so the request, the reconciliation job and
 * a provider callback can all try to settle the same withdrawal safely.
 */
@Injectable()
export class WithdrawalPayoutService {
  private readonly logger = new Logger(WithdrawalPayoutService.name);
  private reconciling = false;

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private notificationsService: NotificationsService,
    @Optional() private jobLock?: JobLockService,
    @Optional() private alerts?: SecurityAlertsService,
    @Optional() private configService?: ConfigService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Where the provider posts the outcome of a payout (WithdrawalCallbacksController). */
  private callbackUrl(provider: string): string | undefined {
    const backendUrl = this.configService?.get<string>('BACKEND_URL')
      || this.configService?.get<string>('RENDER_EXTERNAL_URL')
      || (this.configService ? `http://localhost:${this.configService.get<number>('PORT', 3000)}` : '');
    return backendUrl ? `${backendUrl.replace(/\/+$/, '')}/api/v1/webhooks/payouts/${provider}` : undefined;
  }

  /** Starts the payout of a withdrawal whose funds are already reserved. */
  async dispatch(withdrawal: any, callbackUrl?: string): Promise<{ withdrawal: any; rejectedReason?: string; manual?: boolean }> {
    const adapter = this.pspFactory.get(withdrawal.psp_provider || undefined);

    // No payout API, or a channel the provider cannot send to (a bank account with FlexPaie): the request stays
    // PENDING, funds reserved, for an admin to send by hand.
    if (isManualPayout(adapter, withdrawal.channel)) {
      // Somebody has to send this money: tell the administrators now (bell + push), never fail the request over it.
      const label = `${(Number(withdrawal.amount_cents) / 100).toLocaleString('fr-FR')} ${withdrawal.currency}`;
      void Promise.resolve().then(() => this.alerts?.alert({
        severity: 'warning',
        audience: 'admins',
        title: 'Nouveau retrait à traiter',
        body: `${label} à envoyer. Administration → Retraits à traiter.`,
        dedupeKey: `withdrawal-new:${withdrawal.id}`,
        data: { withdrawal_id: withdrawal.id, kind: 'manual_withdrawal' },
      })).catch((err) => this.logger.error(`Could not alert the administrators: ${err?.message}`));
      return { withdrawal, manual: true };
    }

    let result;
    try {
      result = await adapter.payout({
        reference: withdrawal.id,
        amount_cents: withdrawal.amount_cents,
        currency: withdrawal.currency,
        channel: withdrawal.channel,
        destination: withdrawal.destination,
        callback_url: callbackUrl ?? this.callbackUrl(adapter.provider),
      });
    } catch (err: any) {
      if (err instanceof PayoutRetryLaterError) {
        // Certainly not sent, for a passing reason: stays open, funds reserved; reconcile() sends it again.
        this.logger.warn(`Payout for withdrawal ${withdrawal.id} not sent yet, will be retried: ${err.message}`);
        return { withdrawal };
      }
      if (err instanceof PayoutNotSentError) {
        const adminAlert = err.adminAlert;
        if (adminAlert) {
          void Promise.resolve().then(() => this.alerts?.alert({
            severity: 'critical',
            audience: 'admins',
            title: 'Retrait automatique impossible',
            body: `${adminAlert} Le client a été remboursé dans son portefeuille.`,
            dedupeKey: `payout-blocked:${adapter.provider}:${adminAlert.slice(0, 40)}`,
            data: { withdrawal_id: withdrawal.id, kind: 'payout_blocked' },
          })).catch((e) => this.logger.error(`Could not alert the administrators: ${e?.message}`));
        }
        const reversed = await this.apply(withdrawal.id, { status: 'FAILED', reason: err.message });
        return { withdrawal: reversed ?? withdrawal, rejectedReason: err.message };
      }
      // Ambiguous (timeout, network, 5xx): the money may have left. Leave the
      // withdrawal open — reconcile() asks the provider what really happened.
      this.logger.error(`Payout for withdrawal ${withdrawal.id} ended with an unknown outcome, left open for reconciliation: ${err.message}`);
      return { withdrawal };
    }

    const outcome: PayoutOutcome =
      result.status === 'FAILED'
        ? { status: 'FAILED', reason: result.failure_reason || 'Le virement a été refusé.' }
        : { status: result.status, psp_reference: result.psp_payout_id };

    const settled = await this.apply(withdrawal.id, outcome);
    return {
      withdrawal: settled ?? withdrawal,
      rejectedReason: outcome.status === 'FAILED' ? outcome.reason : undefined,
    };
  }

  /**
   * Records what the provider said about a payout. Idempotent: a withdrawal
   * that is already settled is left alone and the current row is returned.
   */
  async apply(withdrawalId: string, outcome: PayoutOutcome): Promise<any> {
    let changed: any = null;

    if (outcome.status === 'SUCCESS') {
      const { data } = await this.db.rpc('finish_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_psp_reference: outcome.psp_reference ?? null,
      }).single();
      changed = data;
      if (changed) await this.notify(changed, 'withdrawal_success');
    } else if (outcome.status === 'FAILED') {
      const { data } = await this.db.rpc('fail_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_reason: outcome.reason,
      }).single();
      changed = data;
      if (changed) await this.notify(changed, 'withdrawal_failed');
    } else {
      const { data } = await this.db.rpc('mark_withdrawal_processing', {
        p_withdrawal_id: withdrawalId,
        p_psp_reference: outcome.psp_reference ?? null,
      }).single();
      changed = data;
    }

    if (changed) return changed;
    const { data: current } = await this.db.from('withdrawals').select('*').eq('id', withdrawalId).single();
    return current;
  }

  /** Settles withdrawals that stayed open: asks the provider what happened. */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<number> {
    if (this.reconciling) return 0;
    // One API instance per minute (migration 053).
    if (this.jobLock && !(await this.jobLock.acquire('withdrawal-reconcile', 50))) return 0;
    this.reconciling = true;
    try {
      const { data: open, error } = await this.db
        .from('withdrawals')
        .select('*')
        .in('status', ['PENDING', 'PROCESSING'])
        .lt('updated_at', new Date(Date.now() - RECONCILE_MIN_AGE_MS).toISOString())
        .order('updated_at', { ascending: true })
        .limit(RECONCILE_BATCH_SIZE);

      if (error) {
        this.logger.error(`Could not list open withdrawals: ${error.message}`);
        return 0;
      }

      let settled = 0;
      for (const w of open || []) {
        try {
          if (await this.reconcileOne(w)) settled++;
        } catch (err: any) {
          this.logger.error(`Could not reconcile withdrawal ${w.id}: ${err.message}`);
        }
      }
      if (settled > 0) this.logger.log(`Settled ${settled} open withdrawal(s)`);
      return settled;
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOne(w: any): Promise<boolean> {
    const adapter = this.pspFactory.get(w.psp_provider || undefined);
    // A manual withdrawal is unknown to the provider by design: "not found" must NEVER be read as "never sent"
    // (that would refund the wallet while an admin may be sending the money).
    // ...unless it was already handed to the provider (automatic payouts switched off since): that one is followed
    // to its end like any other, never left to an admin who could refund or re-send it.
    const manual = isManualPayout(adapter, w.channel);
    if (manual && !(adapter.payoutsInFlight && (await adapter.payoutsInFlight([w.id])).has(w.id))) return false;
    const status = await adapter.getPayoutStatus(w.id, { psp_reference: w.psp_reference ?? null });

    if (status.status === 'NOT_SENT') {
      // Never handed to the provider (asked during the manual period, refused as busy, or the request died before
      // sending): the adapter's journal says it is safe to send, so send it now — if payouts are still automatic.
      if (manual) return false;
      if (w.status !== 'PENDING') {
        this.logger.warn(`Withdrawal ${w.id} is ${w.status} but the provider says it was never sent — left alone`);
        return false;
      }
      const sent = await this.dispatch(w);
      return sent.withdrawal?.status !== w.status;
    }

    if (status.status === 'SUCCESS') {
      await this.apply(w.id, { status: 'SUCCESS', psp_reference: status.psp_payout_id });
      return true;
    }
    if (status.status === 'FAILED') {
      await this.apply(w.id, { status: 'FAILED', reason: status.failure_reason || 'Le virement a échoué.' });
      return true;
    }
    if (status.status === 'NOT_FOUND') {
      const openForMs = Date.now() - new Date(w.created_at).getTime();
      if (w.status === 'PENDING' && openForMs > NOT_SENT_GRACE_MS) {
        // We reserved the money but the provider never heard of this payout
        // (the request died before sending it): safe to give the money back.
        await this.apply(w.id, { status: 'FAILED', reason: "Le virement n'a jamais été envoyé." });
        return true;
      }
      if (w.status === 'PROCESSING') {
        this.logger.warn(`Withdrawal ${w.id} was accepted by the provider but is now unknown to it — needs a manual check`);
      }
    }
    return false;
  }

  /**
   * The provider's payout callback. Never a verdict by itself (FlexPaie's is unsigned): the adapter extracts which
   * withdrawal it is about, and that withdrawal is settled from what the provider's status check says.
   */
  async handleCallback(provider: string, payload: Buffer): Promise<{ received: true }> {
    let adapter;
    try {
      adapter = this.pspFactory.get(provider);
    } catch {
      throw new NotFoundException();
    }
    if (!adapter.acceptPayoutCallback) throw new NotFoundException();

    const reference = await adapter.acceptPayoutCallback(payload ?? Buffer.alloc(0));
    if (!reference || !/^[0-9a-f-]{36}$/i.test(reference)) return { received: true };
    const { data: w } = await this.db.from('withdrawals').select('*').eq('id', reference).maybeSingle();
    if (!w || w.psp_provider !== adapter.provider) return { received: true };

    if (w.status === 'PENDING' || w.status === 'PROCESSING') {
      await this.reconcileOne(w);
    } else if (w.status === 'REVERSED') {
      // Refunded because the provider never answered… and now it says the money left: paid twice. Tell someone.
      const status = await adapter.getPayoutStatus(w.id, { psp_reference: w.psp_reference ?? null }).catch(() => null);
      if (status?.status === 'SUCCESS') {
        this.logger.error(`Withdrawal ${w.id} was refunded but the provider reports it as paid`);
        void Promise.resolve().then(() => this.alerts?.alert({
          severity: 'critical',
          audience: 'admins',
          title: 'Retrait payé ET remboursé',
          body: `Le retrait ${w.id} a été remboursé faute de réponse, mais FlexPaie confirme maintenant l'envoi (${status.psp_payout_id ?? 'sans numéro'}). À régulariser avec le client.`,
          dedupeKey: `payout-double:${w.id}`,
          data: { withdrawal_id: w.id, kind: 'payout_double' },
        })).catch(() => null);
      }
    }
    return { received: true };
  }

  private async notify(withdrawal: any, type: 'withdrawal_success' | 'withdrawal_failed') {
    const { data: wallet } = await this.db.from('wallets').select('user_id').eq('id', withdrawal.wallet_id).single();
    if (!wallet) return;

    const label = `${(withdrawal.amount_cents / 100).toLocaleString('fr-FR')} ${withdrawal.currency}`;
    await this.notificationsService.create({
      user_id: wallet.user_id,
      type,
      title: type === 'withdrawal_success' ? 'Retrait effectué' : 'Retrait échoué',
      body: type === 'withdrawal_success'
        ? `Votre retrait de ${label} a été envoyé.`
        : `Votre retrait de ${label} a échoué : ${withdrawal.failure_reason || 'virement refusé'}. Le montant et les frais ont été remis dans votre portefeuille.`,
      data: { withdrawal_id: withdrawal.id },
    }).catch(() => null);
  }
}
