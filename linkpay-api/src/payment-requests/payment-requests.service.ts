import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { CommissionsService } from '../commissions/commissions.service';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';

@Injectable()
export class PaymentRequestsService {
  private readonly logger = new Logger(PaymentRequestsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private commissionsService: CommissionsService,
    private configService: ConfigService,
  ) {}

  async createPaymentRequest(merchantId: string, merchantUserId: string, data: {
    amount_cents: number;
    currency?: string;
    description?: string;
    customer_info?: { name?: string; phone?: string };
    commission_model?: string;
    expires_in_minutes?: number;
  }) {
    const reference = this.generateReference();
    const linkToken = uuidv4().replace(/-/g, '');
    const currency = data.currency || (await this.getMerchantDefaultCurrency(merchantId));
    const commissionModel = data.commission_model || 'MERCHANT_PAID';

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (data.expires_in_minutes || 30));

    const { data: request, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .insert({
        merchant_id: merchantId,
        merchant_user_id: merchantUserId,
        amount_cents: data.amount_cents,
        currency,
        reference,
        description: data.description,
        customer_info: data.customer_info,
        link_token: linkToken,
        status: 'CREATED',
        commission_model: commissionModel,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create payment request: ${error.message}`);
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const paymentLink = `${frontendUrl}/p/${linkToken}`;

    const qrBuffer = await QRCode.toBuffer(paymentLink, {
      width: 400,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });

    const { data: uploadData, error: uploadError } = await this.supabaseService.getClient()
      .storage
      .from('qr-codes')
      .upload(`${linkToken}.png`, qrBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    let qrCodeUrl: string | undefined;
    if (!uploadError && uploadData) {
      const { data: urlData } = this.supabaseService.getClient()
        .storage
        .from('qr-codes')
        .getPublicUrl(`${linkToken}.png`);
      qrCodeUrl = urlData.publicUrl;
    }

    if (qrCodeUrl) {
      const { error: updateError } = await this.supabaseService.getClient()
        .from('payment_requests')
        .update({ qr_code_url: qrCodeUrl })
        .eq('id', request.id);

      if (updateError) {
        this.logger.warn(`Failed to persist qr_code_url for ${request.id}: ${updateError.message}`);
      }
    }

    // Build the response from the row we already have instead of a second
    // round-trip — a failed/undefined result there previously caused the
    // whole response to silently collapse to just `{payment_link}`.
    return {
      ...request,
      qr_code_url: qrCodeUrl,
      payment_link: paymentLink,
    };
  }

  async getByLinkToken(linkToken: string) {
    const { data: request, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select(`
        *,
        merchant:merchants(id, name, phone, email, address, city)
      `)
      .eq('link_token', linkToken)
      .single();

    if (error || !request) {
      throw new NotFoundException('Payment request not found');
    }

    if (request.status === 'EXPIRED' || (request.expires_at && new Date(request.expires_at) < new Date())) {
      await this.markExpired(request.id);
      throw new BadRequestException('Payment request has expired');
    }

    if (request.status === 'PAID') {
      throw new BadRequestException('Payment request already paid');
    }

    if (request.status === 'CANCELLED') {
      throw new BadRequestException('Payment request was cancelled');
    }

    const fees = await this.commissionsService.calculateFeesPreview(
      request.amount_cents,
      request.currency,
      request.merchant_id,
      request.commission_model,
    );

    return {
      reference: request.reference,
      amount_cents: request.amount_cents,
      currency: request.currency,
      description: request.description,
      merchant: request.merchant,
      commission_model: request.commission_model,
      fees,
      total_cents: fees.total_cents,
    };
  }

  /**
   * Authenticated counterpart to getByLinkToken() — used by the in-app "Payer
   * une facture" flow (§39: the client types the invoice reference, not the
   * long link_token from a QR code/URL). Same enriched shape (merchant info
   * + live fee preview) and the same status guards, just keyed by the
   * human-readable reference instead.
   */
  async getByReference(reference: string) {
    const { data: request, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select(`*, merchant:merchants(id, name, phone, email, address, city, logo_url)`)
      .eq('reference', reference.trim().toUpperCase())
      .single();

    if (error || !request) {
      throw new NotFoundException('Facture introuvable');
    }

    if (request.status === 'EXPIRED' || (request.expires_at && new Date(request.expires_at) < new Date())) {
      await this.markExpired(request.id);
      throw new BadRequestException('Cette facture a expiré');
    }
    if (request.status === 'PAID') {
      throw new BadRequestException('Cette facture a déjà été payée');
    }
    if (request.status === 'CANCELLED') {
      throw new BadRequestException('Cette facture a été annulée');
    }

    const fees = await this.commissionsService.calculateFeesPreview(
      request.amount_cents,
      request.currency,
      request.merchant_id,
      request.commission_model,
    );

    return {
      link_token: request.link_token,
      reference: request.reference,
      amount_cents: request.amount_cents,
      currency: request.currency,
      description: request.description,
      merchant: request.merchant,
      commission_model: request.commission_model,
      fees,
      total_cents: fees.total_cents,
    };
  }

  async getMerchantRequests(merchantId: string, filters?: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    let query = this.supabaseService.getClient()
      .from('payment_requests')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch payment requests: ${error.message}`);
    }

    return {
      data,
      total: count || 0,
      page,
      limit,
    };
  }

  async cancelRequest(requestId: string, merchantId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('merchant_id', merchantId)
      .in('status', ['CREATED', 'PENDING'])
      .select()
      .single();

    if (error || !data) {
      throw new BadRequestException('Cannot cancel this payment request');
    }

    return data;
  }

  async markPaid(requestId: string) {
    await this.supabaseService.getClient()
      .from('payment_requests')
      .update({
        status: 'PAID',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);
  }

  private async markExpired(requestId: string) {
    await this.supabaseService.getClient()
      .from('payment_requests')
      .update({
        status: 'EXPIRED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);
  }

  private async getMerchantDefaultCurrency(merchantId: string): Promise<string> {
    const { data } = await this.supabaseService.getClient()
      .from('merchants')
      .select('default_currency')
      .eq('id', merchantId)
      .single();
    return data?.default_currency || 'CDF';
  }

  private generateReference(): string {
    const date = new Date();
    const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `LP-${ymd}-${random}`;
  }
}
