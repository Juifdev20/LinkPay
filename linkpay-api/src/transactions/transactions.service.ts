import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class TransactionsService {
  constructor(private supabaseService: SupabaseService) {}

  async getTransactionById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select(`
        *,
        merchant:merchants(id, name),
        receipt:receipts(id, payload, pdf_url)
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Transaction not found');
    }

    return data;
  }

  async getTransactionByReference(reference: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select(`
        *,
        merchant:merchants(id, name),
        receipt:receipts(id, payload)
      `)
      .eq('reference', reference)
      .single();

    if (error || !data) {
      throw new NotFoundException('Transaction not found');
    }

    return data;
  }

  async getClientTransactions(clientId: string, filters?: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    let query = this.supabaseService.getClient()
      .from('transactions')
      .select('*, merchant:merchants(name)', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

    return { data, total: count || 0, page, limit };
  }

  async getMerchantTransactions(merchantId: string, filters?: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    let query = this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.search) {
      query = query.or(`reference.ilike.%${filters.search}%,psp_reference.ilike.%${filters.search}%`);
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

    return { data, total: count || 0, page, limit };
  }

  async getAllTransactions(filters?: {
    status?: string;
    merchant_id?: string;
    page?: number;
    limit?: number;
  }) {
    let query = this.supabaseService.getClient()
      .from('transactions')
      .select('*, merchant:merchants(name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.merchant_id) query = query.eq('merchant_id', filters.merchant_id);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

    return { data, total: count || 0, page, limit };
  }

  async getReceipt(transactionId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('receipts')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Receipt not found');
    }

    return data;
  }
}
