import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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
