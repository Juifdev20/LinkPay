import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';

const RETRY_BATCH_SIZE = 50;
// Give the normal path (webhook handler) time to finish before the retry job
// looks at a transaction, so the two rarely meet.
const RETRY_GRACE_MS = 30_000;

/**
 * Pays a successful transaction's net amount (amount - PSP fee - platform
 * commission) into the wallet of the merchant's owner, automatically.
 *
 * The crediting itself is credit_merchant_wallet() in the database (migration
 * 041): it locks the transaction and stamps wallet_credited_at, so calling it
 * twice — webhook + retry job, or two webhook deliveries — credits once.
 * This class only decides when to call it and never lets a failure take the
 * payment itself down: an uncredited transaction is picked up by the retry
 * job within a minute.
 */
@Injectable()
export class MerchantWalletCreditService {
  private readonly logger = new Logger(MerchantWalletCreditService.name);
  private retryRunning = false;

  constructor(private supabaseService: SupabaseService) {}

  /** @returns true when the wallet was credited (or already had been). */
  async credit(transactionId: string): Promise<boolean> {
    const { error } = await this.supabaseService.getClient().rpc('credit_merchant_wallet', {
      p_transaction_id: transactionId,
    });

    if (error) {
      this.logger.error(`Could not credit merchant wallet for transaction ${transactionId}: ${error.message}`);
      return false;
    }
    return true;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryUncredited(): Promise<number> {
    if (this.retryRunning) return 0;
    this.retryRunning = true;
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('transactions')
        .select('id')
        .in('status', ['SUCCESS', 'PARTIALLY_REFUNDED'])
        .is('wallet_credited_at', null)
        .lt('created_at', new Date(Date.now() - RETRY_GRACE_MS).toISOString())
        .order('created_at', { ascending: true })
        .limit(RETRY_BATCH_SIZE);

      if (error) {
        this.logger.error(`Retry of uncredited transactions failed: ${error.message}`);
        return 0;
      }

      let credited = 0;
      for (const tx of data || []) {
        if (await this.credit(tx.id)) credited++;
      }
      if (credited > 0) this.logger.log(`Credited ${credited} previously uncredited transaction(s)`);
      return credited;
    } finally {
      this.retryRunning = false;
    }
  }
}
