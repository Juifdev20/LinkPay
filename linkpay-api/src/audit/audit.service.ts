import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private supabaseService: SupabaseService) {}

  async log(data: {
    user_id?: string;
    action: string;
    entity_type: string;
    entity_id?: string;
    changes?: Record<string, any>;
    ip_address?: string;
    user_agent?: string;
  }) {
    const { error } = await this.supabaseService.getClient()
      .from('audit_logs')
      .insert({
        user_id: data.user_id || null,
        action: data.action,
        entity_type: data.entity_type,
        entity_id: data.entity_id || null,
        changes: data.changes || {},
        ip_address: data.ip_address || null,
        user_agent: data.user_agent || null,
      });

    if (error) {
      this.logger.error(`Failed to write audit log: ${error.message}`);
    }
  }

  async getAuditLogs(filters?: {
    user_id?: string;
    entity_type?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) {
    let query = this.supabaseService.getClient()
      .from('audit_logs')
      .select('*, user:profiles!user_id(email, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters?.user_id) query = query.eq('user_id', filters.user_id);
    if (filters?.entity_type) query = query.eq('entity_type', filters.entity_type);
    if (filters?.action) query = query.eq('action', filters.action);

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch audit logs: ${error.message}`);
    return { data, total: count || 0, page, limit };
  }
}
