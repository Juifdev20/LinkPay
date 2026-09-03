import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private supabaseService: SupabaseService) {}

  async writePaymentEntries(transaction: any): Promise<void> {
    const entries = [
      {
        transaction_id: transaction.id,
        entry_type: 'PAYMENT',
        direction: 'credit',
        amount_cents: transaction.amount_cents,
        currency: transaction.currency,
        reference: transaction.reference,
        source: 'webhook',
        metadata: { psp_reference: transaction.psp_reference },
      },
      {
        transaction_id: transaction.id,
        entry_type: 'PSP_FEE',
        direction: 'debit',
        amount_cents: transaction.psp_fee_cents,
        currency: transaction.currency,
        reference: transaction.reference,
        source: 'system',
        metadata: { description: 'PSP processing fee' },
      },
      {
        transaction_id: transaction.id,
        entry_type: 'PLATFORM_FEE',
        direction: 'debit',
        amount_cents: transaction.platform_fee_cents,
        currency: transaction.currency,
        reference: transaction.reference,
        source: 'system',
        metadata: { description: 'LinkPay commission', commission_rule_id: transaction.commission_rule_id },
      },
    ];

    const { error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .insert(entries);

    if (error) {
      this.logger.error(`Failed to write ledger entries: ${error.message}`);
      throw new Error(`Ledger write failed: ${error.message}`);
    }

    this.logger.log(`Wrote ${entries.length} ledger entries for transaction ${transaction.reference}`);
  }

  async writeRefundEntry(transaction: any, refundAmountCents: number, refundId: string): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .insert({
        transaction_id: transaction.id,
        entry_type: 'REFUND',
        direction: 'debit',
        amount_cents: refundAmountCents,
        currency: transaction.currency,
        reference: transaction.reference,
        source: 'system',
        metadata: { refund_id: refundId },
      });

    if (error) {
      this.logger.error(`Failed to write refund ledger entry: ${error.message}`);
      throw new Error(`Ledger refund write failed: ${error.message}`);
    }
  }

  async writeSettlementEntry(settlement: any): Promise<void> {
    const { error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .insert({
        settlement_id: settlement.id,
        entry_type: 'SETTLEMENT',
        direction: 'debit',
        amount_cents: settlement.net_cents,
        currency: 'CDF',
        reference: settlement.reference,
        source: 'system',
        metadata: { merchant_id: settlement.merchant_id },
      });

    if (error) {
      this.logger.error(`Failed to write settlement ledger entry: ${error.message}`);
      throw new Error(`Ledger settlement write failed: ${error.message}`);
    }
  }

  async writeAdjustmentEntry(transactionId: string, amountCents: number, currency: string, reason: string): Promise<void> {
    const direction = amountCents >= 0 ? 'credit' : 'debit';
    const { error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .insert({
        transaction_id: transactionId,
        entry_type: 'ADJUSTMENT',
        direction,
        amount_cents: Math.abs(amountCents),
        currency,
        reference: `ADJ-${Date.now()}`,
        source: 'manual',
        metadata: { reason },
      });

    if (error) {
      this.logger.error(`Failed to write adjustment ledger entry: ${error.message}`);
      throw new Error(`Ledger adjustment write failed: ${error.message}`);
    }
  }

  async getTransactionEntries(transactionId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to fetch ledger entries: ${error.message}`);
    return data;
  }

  async verifyBalance(transactionId: string): Promise<boolean> {
    const entries = await this.getTransactionEntries(transactionId);
    const credits = entries.filter((e: any) => e.direction === 'credit').reduce((sum: number, e: any) => sum + e.amount_cents, 0);
    const debits = entries.filter((e: any) => e.direction === 'debit').reduce((sum: number, e: any) => sum + e.amount_cents, 0);
    return credits === debits;
  }
}
