import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/** Money going out of a wallet: more than this many operations in an hour is a drain, not a customer. */
export const MAX_OUTFLOW_OPS_PER_HOUR = 10;
/** Sending to this many different wallets within 10 minutes is a fan-out (mule distribution). */
export const MAX_DISTINCT_RECIPIENTS_10MIN = 5;
/** A wallet younger than this is "new": the favourite of fraudsters who cash out right after sign-up. */
export const NEW_WALLET_AGE_MS = 24 * 3_600_000;
/** What a brand-new wallet may withdraw/transfer in one operation, in cents, per currency. */
export const NEW_WALLET_MAX_CENTS: Record<string, number> = { CDF: 50_000_000, USD: 20_000 };
/** Operations from this amount up are logged for review without being blocked. */
export const REVIEW_AMOUNT_CENTS: Record<string, number> = { CDF: 200_000_000, USD: 100_000 };

export type OutflowKind = 'TRANSFER' | 'WITHDRAWAL';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(private supabaseService: SupabaseService) {}

  async checkTransactionRisk(transactionData: {
    merchant_id: string;
    amount_cents: number;
    currency: string;
    client_id?: string;
  }): Promise<{ risk_score: number; flags: string[] }> {
    const flags: string[] = [];
    let riskScore = 0;

    if (transactionData.amount_cents > 10000000) {
      flags.push('LARGE_AMOUNT');
      riskScore += 30;
    }

    if (transactionData.amount_cents > 50000000) {
      flags.push('VERY_LARGE_AMOUNT');
      riskScore += 40;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', transactionData.merchant_id)
      .eq('status', 'SUCCESS')
      .gte('created_at', oneHourAgo);

    if ((count || 0) > 50) {
      flags.push('HIGH_FREQUENCY');
      riskScore += 20;
    }

    if (transactionData.client_id) {
      const { count: clientCount } = await this.supabaseService.getClient()
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', transactionData.client_id)
        .eq('status', 'FAILED')
        .gte('created_at', oneHourAgo);

      if ((clientCount || 0) > 5) {
        flags.push('MULTIPLE_FAILED_ATTEMPTS');
        riskScore += 25;
      }
    }

    return { risk_score: Math.min(riskScore, 100), flags };
  }

  /**
   * Velocity checks for money leaving a wallet (called before a transfer or a
   * withdrawal reserves any funds). Throws 429 when the pattern looks like an
   * account being drained or used as a mule; otherwise returns, after logging
   * (risk_logs) the operations that merit a human look. Every block is logged
   * too, so an admin sees the attempt.
   *
   * It is a second line behind the PIN, the wallet limits and the atomic
   * debit — it never decides who owns what money. A failure to read the
   * history is logged and lets the operation through: those other defences
   * still apply, and an outage here must not freeze every payment.
   */
  async assessOutflow(p: {
    kind: OutflowKind;
    userId: string;
    walletId: string;
    amountCents: number;
    currency: string;
    recipientWalletId?: string;
  }): Promise<void> {
    const flags: string[] = [];
    let block: string | null = null;
    try {
      const client = this.supabaseService.getClient();
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const tenMinAgo = new Date(Date.now() - 600_000).toISOString();

      const [transfers, withdrawals, wallet] = await Promise.all([
        client.from('transfers').select('recipient_wallet_id, created_at').eq('sender_wallet_id', p.walletId).gte('created_at', hourAgo),
        client.from('withdrawals').select('id').eq('wallet_id', p.walletId).gte('created_at', hourAgo),
        client.from('wallets').select('created_at').eq('id', p.walletId).single(),
      ]);

      const transferRows: any[] = transfers.data || [];
      const opsLastHour = transferRows.length + (withdrawals.data || []).length;
      if (opsLastHour >= MAX_OUTFLOW_OPS_PER_HOUR) {
        flags.push('OUTFLOW_VELOCITY');
        block = 'velocity';
      }

      if (p.kind === 'TRANSFER' && p.recipientWalletId) {
        const recent = new Set(transferRows.filter((t) => t.created_at >= tenMinAgo).map((t) => t.recipient_wallet_id));
        if (!recent.has(p.recipientWalletId) && recent.size >= MAX_DISTINCT_RECIPIENTS_10MIN) {
          flags.push('RECIPIENT_FAN_OUT');
          block = block ?? 'fan_out';
        }
      }

      const createdAt = wallet.data?.created_at ? new Date(wallet.data.created_at).getTime() : null;
      const cap = NEW_WALLET_MAX_CENTS[p.currency];
      if (createdAt && Date.now() - createdAt < NEW_WALLET_AGE_MS && cap && p.amountCents > cap) {
        flags.push('NEW_WALLET_LARGE_OUTFLOW');
        block = block ?? 'new_wallet';
      }

      const review = REVIEW_AMOUNT_CENTS[p.currency];
      if (review && p.amountCents >= review) flags.push('LARGE_OUTFLOW');
    } catch (err: any) {
      this.logger.error(`Outflow risk check failed (letting the operation through): ${err?.message}`);
      return;
    }

    if (flags.length === 0) return;

    await this.recordOutflowFlags(p, flags, block !== null);

    if (block) {
      throw new HttpException(
        "Par mesure de sécurité, cette opération est temporairement suspendue. Réessayez plus tard ou contactez le support si vous pensez qu'il s'agit d'une erreur.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordOutflowFlags(
    p: { kind: OutflowKind; userId: string; walletId: string; amountCents: number; currency: string },
    flags: string[],
    blocked: boolean,
  ) {
    this.logger.warn(`Outflow ${blocked ? 'BLOCKED' : 'flagged'}: ${p.kind} ${p.amountCents} ${p.currency} wallet=${p.walletId} flags=${flags.join(',')}`);
    const { error } = await this.supabaseService.getClient().from('risk_logs').insert({
      risk_score: blocked ? 90 : 40,
      flags: flags.map((code) => ({
        code,
        kind: p.kind,
        user_id: p.userId,
        wallet_id: p.walletId,
        amount_cents: p.amountCents,
        currency: p.currency,
        blocked,
      })),
    });
    if (error) this.logger.error(`Failed to write risk log: ${error.message}`);
  }

  async getRiskLogs(filters?: { resolved?: boolean }) {
    let query = this.supabaseService.getClient()
      .from('risk_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters?.resolved !== undefined) {
      query = query.eq('resolved', filters.resolved);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch risk logs: ${error.message}`);
    return data;
  }

  async resolveRiskLog(id: string, resolution: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('risk_logs')
      .update({
        resolved: true,
        resolution,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to resolve risk log: ${error.message}`);
    return data;
  }
}
