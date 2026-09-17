import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { initializeApp, cert, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { SupabaseService } from '../supabase/supabase.service';

interface SubscribeParams {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Sends real system-level Web Push notifications (VAPID) — the counterpart
 * to NotificationsService's in-app notification rows, which alone can't
 * reach a user whose PWA isn't open. NotificationsService.create() calls
 * sendPush() as a best-effort side effect after every notification it
 * writes; nothing here may ever throw into that call path.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly configured: boolean;
  private readonly fcmConfigured: boolean;
  private fcmApp?: App;

  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.configService.get<string>('VAPID_SUBJECT');
    this.configured = !!(publicKey && privateKey && subject);
    if (this.configured) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    } else {
      this.logger.warn('VAPID keys not set — web push notifications disabled');
    }

    const fcmProjectId = this.configService.get<string>('FCM_PROJECT_ID');
    const fcmClientEmail = this.configService.get<string>('FCM_CLIENT_EMAIL');
    const fcmPrivateKey = this.configService.get<string>('FCM_PRIVATE_KEY');
    this.fcmConfigured = !!(fcmProjectId && fcmClientEmail && fcmPrivateKey);
    if (this.fcmConfigured) {
      this.fcmApp = initializeApp(
        {
          credential: cert({
            projectId: fcmProjectId,
            clientEmail: fcmClientEmail,
            // Render env vars can't hold real newlines — the private key is
            // stored with literal "\n" sequences and unescaped here.
            privateKey: fcmPrivateKey!.replace(/\\n/g, '\n'),
          }),
        },
        'linkpay-fcm',
      );
    } else {
      this.logger.warn('FCM credentials not set — Android native push notifications disabled');
    }
  }

  /**
   * Upserts on `endpoint` (globally unique per the Push API, not scoped to
   * ScanLinkPay) — a device re-subscribing (storage cleared, different account
   * logged in on the same browser) replaces its old row instead of erroring
   * or leaving a stale duplicate.
   */
  async subscribe(userId: string, params: SubscribeParams, userAgent?: string) {
    const { error } = await this.supabaseService.getClient()
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: params.endpoint,
          p256dh: params.keys.p256dh,
          auth: params.keys.auth,
          user_agent: userAgent || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      );

    if (error) {
      throw new Error(`Failed to save push subscription: ${error.message}`);
    }
    return { success: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.supabaseService.getClient()
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
    return { success: true };
  }

  /** FCM counterpart of subscribe() — upserts on `fcm_token`, the native
   * equivalent of a Web Push endpoint's uniqueness. */
  async subscribeFcm(userId: string, fcmToken: string, userAgent?: string) {
    const { error } = await this.supabaseService.getClient()
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          platform: 'android',
          fcm_token: fcmToken,
          user_agent: userAgent || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'fcm_token' },
      );

    if (error) {
      throw new Error(`Failed to save FCM subscription: ${error.message}`);
    }
    return { success: true };
  }

  async unsubscribeFcm(userId: string, fcmToken: string) {
    await this.supabaseService.getClient()
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('fcm_token', fcmToken);
    return { success: true };
  }

  /**
   * Fire-and-forget: delivers to every subscription the user has (multiple
   * devices/browsers). Never throws — a push failure must never break the
   * notification-creation call path in notifications.service.ts. A 404/410
   * from the push service means that registration is dead (device
   * uninstalled/reset the permission) — clean it up instead of retrying it
   * forever on every future notification.
   */
  async sendPush(userId: string, payload: { type: string; title: string; body: string; data?: Record<string, any> }) {
    if (!this.configured && !this.fcmConfigured) return;

    const { data: subs, error } = await this.supabaseService.getClient()
      .from('push_subscriptions')
      .select('id, platform, endpoint, p256dh, auth, fcm_token')
      .eq('user_id', userId);

    if (error || !subs?.length) return;

    await Promise.all(subs.map((sub) => (sub.platform === 'android' ? this.sendFcm(sub, payload) : this.sendWebPush(sub, payload))));
  }

  private async sendWebPush(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: { type: string; title: string; body: string; data?: Record<string, any> },
  ) {
    if (!this.configured) return;
    const message = JSON.stringify({
      title: payload.title,
      body: payload.body,
      type: payload.type,
      data: payload.data || {},
    });
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, message);
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await this.supabaseService.getClient().from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        this.logger.error(`Web push send failed for subscription ${sub.id}: ${err.message}`);
      }
    }
  }

  private async sendFcm(
    sub: { id: string; fcm_token: string },
    payload: { type: string; title: string; body: string; data?: Record<string, any> },
  ) {
    if (!this.fcmConfigured || !this.fcmApp) return;
    try {
      await getMessaging(this.fcmApp).send({
        token: sub.fcm_token,
        notification: { title: payload.title, body: payload.body },
        // FCM data payload values must all be strings.
        data: { type: payload.type, ...Object.fromEntries(Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])) },
      });
    } catch (err: any) {
      if (err.code === 'messaging/registration-token-not-registered') {
        await this.supabaseService.getClient().from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        this.logger.error(`FCM send failed for subscription ${sub.id}: ${err.message}`);
      }
    }
  }
}
