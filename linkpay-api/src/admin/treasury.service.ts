import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

type Row = {
  currency: string;
  owed_wallets: number;
  owed_savings: number;
  pending_withdrawals: number;
  uncredited_payments: number;
  negative_wallets: number;
  subscriptions: number;
  commissions: number;
  withdrawal_fees: number;
  transfer_fees: number;
  pro_payments: number;
};

/**
 * Trésorerie (migration 079). The real money is on ScanLinkPay's FlexPaie account; part of it belongs to the users.
 * For each currency:
 *   owed       = balances + savings + withdrawals not sent yet + shop payments not credited yet
 *   available  = FlexPaie balance (typed by the super admin from the FlexPaie dashboard) − owed
 * `available` is what can be taken out of FlexPaie without touching anybody's money. Earned amounts (subscriptions,
 * commissions, fees) are shown for information: they are why `available` exists, not part of the computation.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private supabaseService: SupabaseService,
    private audit: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async overview() {
    const { data, error } = await this.db.rpc('treasury_overview');
    if (error) {
      if (/treasury_overview/.test(error.message) && /does not exist|not find/i.test(error.message)) {
        throw new BadRequestException('La migration 079 (trésorerie) n\'est pas encore appliquée sur cette base.');
      }
      throw new Error(`Failed to compute treasury: ${error.message}`);
    }
    const { data: notes } = await this.db
      .from('treasury_balances')
      .select('currency, amount_cents, note, noted_at, noted_by')
      .order('noted_at', { ascending: false })
      .limit(50);

    // Bureau d'échange (migration 088): what the exchanges earned, in francs. Nothing before that migration is applied.
    const { data: exchangeStats } = await this.db.rpc('exchange_stats');
    const exchangeGainCdf = Number((Array.isArray(exchangeStats) ? exchangeStats[0] : exchangeStats)?.gain_total_cdf_cents) || 0;

    return {
      computed_at: new Date().toISOString(),
      currencies: ((data || []) as Row[]).map((r) => {
        const n = (v: unknown) => Number(v) || 0;
        const owed = n(r.owed_wallets) + n(r.owed_savings) + n(r.pending_withdrawals) + n(r.uncredited_payments);
        const flexpaie = (notes || []).find((b: any) => b.currency === r.currency) ?? null;
        const exchangeGains = r.currency === 'CDF' ? exchangeGainCdf : 0;
        return {
          currency: r.currency,
          owed: {
            wallets: n(r.owed_wallets),
            savings: n(r.owed_savings),
            pending_withdrawals: n(r.pending_withdrawals),
            uncredited_payments: n(r.uncredited_payments),
            total: owed,
          },
          negative_wallets: n(r.negative_wallets),
          earned: {
            subscriptions: n(r.subscriptions),
            commissions: n(r.commissions),
            withdrawal_fees: n(r.withdrawal_fees),
            transfer_fees: n(r.transfer_fees),
            pro_payments: n(r.pro_payments),
            exchange_gains: exchangeGains,
            total: n(r.subscriptions) + n(r.commissions) + n(r.withdrawal_fees) + n(r.transfer_fees) + n(r.pro_payments) + exchangeGains,
          },
          flexpaie_balance: flexpaie ? { amount_cents: Number(flexpaie.amount_cents), noted_at: flexpaie.noted_at, note: flexpaie.note } : null,
          // Never shown as available when the FlexPaie balance was never typed in: nobody can know it then.
          available: flexpaie ? Number(flexpaie.amount_cents) - owed : null,
        };
      }),
      history: (notes || []).slice(0, 20),
    };
  }

  /** The FlexPaie balance read in the FlexPaie dashboard, typed in by the super admin (kept with who and when). */
  async noteFlexpaieBalance(adminId: string, currency: string, amountCents: number, note?: string) {
    if (!['CDF', 'USD'].includes(currency)) throw new BadRequestException('Devise inconnue.');
    if (!Number.isInteger(amountCents) || amountCents < 0) throw new BadRequestException('Montant invalide.');
    const { error } = await this.db.from('treasury_balances').insert({ currency, amount_cents: amountCents, note: note?.trim() || null, noted_by: adminId });
    if (error) throw new Error(`Failed to save FlexPaie balance: ${error.message}`);
    await this.audit.log({ user_id: adminId, action: 'TREASURY_FLEXPAIE_BALANCE_NOTED', entity_type: 'treasury', changes: { currency, amount_cents: amountCents } });
    return this.overview();
  }
}
