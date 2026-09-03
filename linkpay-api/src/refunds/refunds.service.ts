import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private ledgerService: LedgerService,
  ) {}

  async createRefund(transactionId: string, data: {
    amount_cents: number;
    reason?: string;
  }, userId: string) {
    const { data: transaction, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (error || !transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status !== 'SUCCESS') {
      throw new BadRequestException('Can only refund successful transactions');
    }

    if (data.amount_cents > transaction.amount_cents) {
      throw new BadRequestException('Refund amount exceeds transaction amount');
    }

    const { data: existingRefunds } = await this.supabaseService.getClient()
      .from('refunds')
      .select('amount_cents')
      .eq('transaction_id', transactionId)
      .in('status', ['PENDING', 'COMPLETED']);

    const alreadyRefunded = (existingRefunds || []).reduce((sum: number, r: any) => sum + r.amount_cents, 0);
    if (alreadyRefunded + data.amount_cents > transaction.amount_cents) {
      throw new BadRequestException('Total refund amount would exceed transaction amount');
    }

    const adapter = this.pspFactory.get(transaction.psp_provider || undefined);
    const pspResult = await adapter.refund({
      psp_intent_id: transaction.psp_reference,
      amount_cents: data.amount_cents,
      reason: data.reason,
    });

    const { data: refund, error: refundError } = await this.supabaseService.getClient()
      .from('refunds')
      .insert({
        transaction_id: transactionId,
        amount_cents: data.amount_cents,
        currency: transaction.currency,
        reason: data.reason,
        status: pspResult.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
        psp_refund_id: pspResult.psp_refund_id,
        processed_by: userId,
      })
      .select()
      .single();

    if (refundError) {
      throw new Error(`Failed to create refund: ${refundError.message}`);
    }

    if (pspResult.status === 'COMPLETED') {
      await this.ledgerService.writeRefundEntry(transaction, data.amount_cents, refund.id);

      await this.supabaseService.getClient()
        .from('transactions')
        .update({ status: 'REFUNDED', updated_at: new Date().toISOString() })
        .eq('id', transactionId);
    }

    this.logger.log(`Refund created: ${refund.id} for transaction ${transactionId}`);
    return refund;
  }

  async getRefundById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('refunds')
      .select('*, transaction:transactions(reference, amount_cents, currency)')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Refund not found');
    }

    return data;
  }

  async getTransactionRefunds(transactionId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('refunds')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch refunds: ${error.message}`);
    return data;
  }
}
