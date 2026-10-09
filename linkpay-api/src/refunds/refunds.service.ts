import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
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

  /**
   * Refunds are paid out of the merchant's own ScanLinkPay wallet into the
   * paying client's wallet, in one database transaction
   * (refund_to_client_wallet, migration 041). If the merchant's wallet
   * doesn't hold enough — typically because they already withdrew the
   * money — the refund is refused and they must top up or refund in cash:
   * the balance never goes negative. A payer without a ScanLinkPay account
   * can't be refunded here either (CinetPay has no refund API, so there is
   * nowhere to send the money): that one is also done in cash.
   */
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

    const { data: refund, error: refundError } = await this.supabaseService.getClient()
      .rpc('refund_to_client_wallet', {
        p_transaction_id: transactionId,
        p_amount_cents: data.amount_cents,
        p_reason: data.reason ?? null,
        p_processed_by: userId,
      })
      .single();

    if (refundError || !refund) {
      throw this.toRefundError(refundError?.message, transaction.currency);
    }

    this.logger.log(`Refund completed: ${(refund as any).id} for transaction ${transactionId}`);

    const amountLabel = `${(data.amount_cents / 100).toLocaleString('fr-FR')} ${transaction.currency}`;
    if (transaction.client_id) {
      await this.notificationsService.create({
        user_id: transaction.client_id,
        type: 'refund_received',
        title: 'Remboursement reçu',
        body: `${amountLabel} ont été ajoutés à votre portefeuille ScanLinkPay (remboursement de ${transaction.reference}).`,
        data: { transaction_id: transactionId, refund_id: (refund as any).id },
      }).catch(() => null);
    }

    return refund;
  }

  private toRefundError(message: string | undefined, currency: string) {
    const code = (message || '').match(/REFUND_[A-Z_]+/)?.[0];
    switch (code) {
      case 'REFUND_INSUFFICIENT_BALANCE': {
        const [, balance, needed] = (message || '').match(/REFUND_INSUFFICIENT_BALANCE:(\d+):(\d+)/) || [];
        const fmt = (cents?: string) => `${(Number(cents || 0) / 100).toLocaleString('fr-FR')} ${currency}`;
        return new BadRequestException(
          `Solde insuffisant : votre portefeuille ScanLinkPay contient ${fmt(balance)} et ce remboursement demande ${fmt(needed)}. Rechargez votre portefeuille, ou remboursez le client en espèces.`,
        );
      }
      case 'REFUND_NO_CLIENT_ACCOUNT':
        return new BadRequestException(
          "Ce client n'a pas de compte ScanLinkPay : le remboursement ne peut pas être fait ici. Remboursez-le en espèces.",
        );
      case 'REFUND_TX_SETTLED':
        return new BadRequestException(
          "Cette transaction a déjà été réglée au marchand avec l'ancien système de règlement : elle ne peut plus être remboursée ici.",
        );
      case 'REFUND_EXCEEDS_AMOUNT':
        return new BadRequestException('Le total remboursé dépasserait le montant de la transaction.');
      case 'REFUND_TX_NOT_REFUNDABLE':
        return new BadRequestException('Seules les transactions réussies peuvent être remboursées.');
      case 'REFUND_TX_NOT_CREDITED':
        return new BadRequestException("Le montant de cette vente n'a pas encore été crédité sur votre portefeuille : réessayez dans quelques instants.");
      case 'REFUND_WALLET_NOT_ACTIVE':
        return new BadRequestException("L'un des portefeuilles concernés est suspendu ou gelé : le remboursement est impossible pour le moment. Contactez le support.");
      case 'REFUND_INVALID_AMOUNT':
        return new BadRequestException('Montant invalide.');
      case 'REFUND_TX_NOT_FOUND':
        return new NotFoundException('Transaction not found');
      default:
        return new Error(`Failed to refund: ${message ?? 'unknown error'}`);
    }
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
