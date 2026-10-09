import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailAlertsService } from './email-alerts.service';
import { SmsAlertsService } from './sms-alerts.service';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertAudience = 'super_admins' | 'admins';

const DEDUPE_MS = 10 * 60_000;
const SEVERITY_LABEL: Record<AlertSeverity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

/**
 * Tells the platform's administrators that something security-relevant just
 * happened — in the app's notification bell and, through the same
 * NotificationsService, as a system push on their phone.
 *
 * Alerts never throw: a broken alert channel must not break the payment,
 * login or admin action that triggered it. The same alert (same dedupeKey) is
 * sent at most once every 10 minutes, so an attacker hammering an endpoint
 * doesn't bury the admins in identical notifications.
 */
@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger(SecurityAlertsService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
    private emailAlerts: EmailAlertsService,
    private smsAlerts: SmsAlertsService,
  ) {}

  async alert(p: {
    severity: AlertSeverity;
    title: string;
    body: string;
    audience?: AlertAudience;
    dedupeKey?: string;
    data?: Record<string, any>;
    /** Never notify this user (e.g. the admin who just did the action). */
    excludeUserId?: string;
  }): Promise<void> {
    try {
      const now = Date.now();
      if (p.dedupeKey) {
        const last = this.lastSent.get(p.dedupeKey);
        if (last && now - last < DEDUPE_MS) return;
        this.lastSent.set(p.dedupeKey, now);
        if (this.lastSent.size > 5000) {
          for (const [k, t] of this.lastSent) if (now - t >= DEDUPE_MS) this.lastSent.delete(k);
        }
      }

      this.logger.warn(`SECURITY ALERT [${p.severity}] ${p.title} — ${p.body}`);

      const recipients = await this.recipients(p.audience ?? 'super_admins');

      // Critical alerts also go by email — to the audience's own addresses
      // plus ALERT_EMAILS — so they reach people whose phone is silent.
      if (p.severity === 'critical' && this.emailAlerts.enabled) {
        void this.emailRecipients(recipients, p.excludeUserId).then((emails) =>
          this.emailAlerts.send(emails, `${SEVERITY_LABEL.critical} ${p.title}`, p.body),
        );
      }
      // …and by SMS, with a short text that says nothing confidential (SMS is not private).
      if (p.severity === 'critical' && this.smsAlerts.enabled) {
        void this.smsRecipients(recipients, p.excludeUserId)
          .then((numbers) => this.smsAlerts.send(numbers, `ScanLinkPay ALERTE: ${p.title}. Ouvrez l'administration.`))
          .catch((err) => this.logger.error(`SMS alert failed: ${err?.message}`));
      }
      await Promise.all(
        recipients
          .filter((id) => id !== p.excludeUserId)
          .map((user_id) =>
            this.notificationsService.create({
              user_id,
              type: 'security_alert',
              title: `${SEVERITY_LABEL[p.severity]} ${p.title}`,
              body: p.body,
              data: { severity: p.severity, ...(p.data || {}) },
            }),
          ),
      );
    } catch (err: any) {
      this.logger.error(`Could not send security alert "${p.title}": ${err?.message}`);
    }
  }

  private async emailRecipients(userIds: string[], excludeUserId?: string): Promise<string[]> {
    const ids = userIds.filter((id) => id !== excludeUserId);
    const emails = [...this.emailAlerts.extraRecipients()];
    if (ids.length > 0) {
      const { data } = await this.supabaseService.getClient().from('profiles').select('email').in('id', ids);
      emails.push(...(data || []).map((r: any) => r.email).filter(Boolean));
    }
    return emails;
  }

  private async smsRecipients(userIds: string[], excludeUserId?: string): Promise<string[]> {
    const ids = userIds.filter((id) => id !== excludeUserId);
    const numbers = [...this.smsAlerts.extraRecipients()];
    if (ids.length > 0) {
      const { data } = await this.supabaseService.getClient().from('profiles').select('phone').in('id', ids);
      numbers.push(...(data || []).map((r: any) => r.phone).filter(Boolean));
    }
    return numbers;
  }

  private async recipients(audience: AlertAudience): Promise<string[]> {
    const slugs = audience === 'super_admins' ? ['super_admin'] : ['admin', 'super_admin'];
    const client = this.supabaseService.getClient();
    const { data: roles } = await client.from('roles').select('id').in('slug', slugs);
    const roleIds = (roles || []).map((r: any) => r.id);
    if (roleIds.length === 0) return [];
    const { data: rows } = await client.from('user_roles').select('user_id').in('role_id', roleIds);
    return Array.from(new Set((rows || []).map((r: any) => r.user_id as string)));
  }
}
