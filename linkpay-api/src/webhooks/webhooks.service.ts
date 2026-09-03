import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private supabaseService: SupabaseService,
    private paymentsService: PaymentsService,
  ) {}

  async handleWebhook(provider: string, payload: Buffer, signature: string, headers: Record<string, string>) {
    return this.paymentsService.processWebhook(provider, payload, signature, headers);
  }

  async getWebhookEvents(filters?: { provider?: string; processed?: boolean }) {
    let query = this.supabaseService.getClient()
      .from('webhook_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters?.provider) query = query.eq('provider', filters.provider);
    if (filters?.processed !== undefined) query = query.eq('processed', filters.processed);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch webhook events: ${error.message}`);
    return data;
  }
}
