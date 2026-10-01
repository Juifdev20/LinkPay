import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pushNotificationsService: PushNotificationsService,
  ) {}

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
      return;
    }

    // Real system-level push (vibration + popup even with the app closed) —
    // best-effort, fire-and-forget. A delivery failure must never surface to
    // the many call sites across payments.service.ts / wallets.service.ts
    // that just want to record an in-app notification.
    this.pushNotificationsService
      .sendPush(data.user_id, { type: data.type, title: data.title, body: data.body, data: data.data })
      .catch((err) => this.logger.error(`Push dispatch failed: ${err.message}`));
  }

  /** Notifications are never auto-deleted or expired — this just paginates
   * through the full archive (default 20/page) instead of the old hardcoded
   * `.limit(50)`, which silently made anything beyond the 50 most recent
   * permanently unreachable. The bell dropdown calls this with no page
   * param (first page); the full-history page (Notifications.tsx) pages
   * through with increasing `page` values. */
  async getUserNotifications(userId: string, filters?: { unread_only?: boolean; page?: number; limit?: number }) {
    let query = this.supabaseService.getClient()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (filters?.unread_only) {
      query = query.eq('read', false);
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

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

  /** Explicit, user-initiated deletion only — the one way a notification
   * ever leaves the archive. Scoped to user_id so nobody can delete
   * another user's notification by guessing an id. */
  async deleteNotification(notificationId: string, userId: string) {
    const { error } = await this.supabaseService.getClient()
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to delete notification: ${error.message}`);
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
