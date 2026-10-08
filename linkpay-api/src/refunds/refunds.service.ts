import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  private assertOwnsTransaction(
    transactionMerchantId: string | undefined,
    callerMerchantId: string | undefined,
    callerRole: string | undefined,
  ) {
    if (this.isAdmin(callerRole)) return;
    if (!callerMerchantId || callerMerchantId !== transactionMerchantId) {
      throw new ForbiddenException('You do not manage this transaction');
    }
  }

  async createRefund(transactionId: string, data: {
    amount_cents: number;
    reason?: string;
  }, userId: string, callerMerchantId: string, callerRole: string) {
    const { data: transaction, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (error || !transaction) {
      throw new NotFoundException('Transaction not found');
    }

    this.assertOwnsTransaction(transaction.merchant_id, callerMerchantId, callerRole);

    // Status, "not yet settled" and "total refunded <= amount" are checked by
    // reserve_refund() under a row lock on the transaction — checking them
    // here first and inserting afterwards let two concurrent refunds both pass.
    const { data: reserved, error: reserveError } = await this.supabaseService.getClient()
      .rpc('reserve_refund', {
        p_transaction_id: transactionId,
        p_amount_cents: data.amount_cents,
        p_reason: data.reason ?? null,
        p_processed_by: userId,
      })
      .single();

    if (reserveError || !reserved) {
      throw this.toRefundError(reserveError?.message);
    }
    let refund: any = reserved;

    let pspResult: { psp_refund_id: string; status: string };
    try {
      const adapter = this.pspFactory.get(transaction.psp_provider || undefined);
      pspResult = await adapter.refund({
        psp_intent_id: transaction.psp_reference,
        amount_cents: data.amount_cents,
        reason: data.reason,
      });
    } catch (err) {
      // Release the reservation so it no longer counts against the
      // refundable amount, then surface the PSP's own error.
      await this.supabaseService.getClient()
        .from('refunds')
        .update({ status: 'FAILED', updated_at: new Date().toISOString() })
        .eq('id', refund.id);
      throw err;
    }

    const completed = pspResult.status === 'COMPLETED';
    const { data: updatedRefund, error: updateError } = await this.supabaseService.getClient()
      .from('refunds')
      .update({
        status: completed ? 'COMPLETED' : 'PENDING',
        psp_refund_id: pspResult.psp_refund_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', refund.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update refund: ${updateError.message}`);
    }
    refund = updatedRefund;

    if (completed) {
      await this.ledgerService.writeRefundEntry(transaction, data.amount_cents, refund.id);

      // Only a full refund closes the transaction — a partial one used to
      // mark it REFUNDED too, which blocked any further refund on it and
      // dropped its remaining amount from the merchant's balance.
      const { data: completedRefunds } = await this.supabaseService.getClient()
        .from('refunds')
        .select('amount_cents')
        .eq('transaction_id', transactionId)
        .eq('status', 'COMPLETED');
      const totalRefunded = (completedRefunds || []).reduce((sum: number, r: any) => sum + r.amount_cents, 0);

      await this.supabaseService.getClient()
        .from('transactions')
        .update({
          status: totalRefunded >= transaction.amount_cents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);
    }

    this.logger.log(`Refund created: ${refund.id} for transaction ${transactionId}`);
    return refund;
  }

  private toRefundError(message?: string) {
    if (message?.includes('REFUND_TX_SETTLED')) {
      return new BadRequestException('Cette transaction a déjà été incluse dans un règlement au marchand — elle ne peut plus être remboursée ici.');
    }
    if (message?.includes('REFUND_EXCEEDS_AMOUNT')) {
      return new BadRequestException('Le total remboursé dépasserait le montant de la transaction.');
    }
    if (message?.includes('REFUND_TX_NOT_REFUNDABLE')) {
      return new BadRequestException('Seules les transactions réussies peuvent être remboursées.');
    }
    if (message?.includes('REFUND_TX_NOT_FOUND')) {
      return new NotFoundException('Transaction not found');
    }
    return new Error(`Failed to reserve refund: ${message ?? 'unknown error'}`);
  }

  async getRefundById(id: string, callerMerchantId: string, callerRole: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('refunds')
      .select('*, transaction:transactions(reference, amount_cents, currency, merchant_id)')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Refund not found');
    }

    this.assertOwnsTransaction(data.transaction?.merchant_id, callerMerchantId, callerRole);

    return data;
  }

  async getTransactionRefunds(transactionId: string, callerMerchantId: string, callerRole: string) {
    const { data: transaction, error: txError } = await this.supabaseService.getClient()
      .from('transactions')
      .select('merchant_id')
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      throw new NotFoundException('Transaction not found');
    }

    this.assertOwnsTransaction(transaction.merchant_id, callerMerchantId, callerRole);

    const { data, error } = await this.supabaseService.getClient()
      .from('refunds')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch refunds: ${error.message}`);
    return data;
  }
}
