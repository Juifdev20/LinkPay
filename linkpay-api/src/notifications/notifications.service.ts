import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private supabaseService: SupabaseService) {}

  async create(data: {
    user_id: string | null;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    if (!data.user_id) return;

    const { error } = await this.supabaseService.getClient()
      .from('notifications')
      .insert({
        user_id: data.user_id,
        type: data.type,
        title: data.title,
        body: data.body,
        data: data.data || {},
      });

    if (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
    }
  }

  async getUserNotifications(userId: string, filters?: { unread_only?: boolean }) {
    let query = this.supabaseService.getClient()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (filters?.unread_only) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);
    return data;
  }

  async markAsRead(notificationId: string, userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(`Failed to mark notification: ${error.message}`);
    return data;
  }

  async markAllAsRead(userId: string) {
    const { error } = await this.supabaseService.getClient()
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw new Error(`Failed to mark all notifications: ${error.message}`);
    return { success: true };
  }

  async getUnreadCount(userId: string) {
    const { count, error } = await this.supabaseService.getClient()
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw new Error(`Failed to get unread count: ${error.message}`);
    return { unread_count: count || 0 };
  }
}
