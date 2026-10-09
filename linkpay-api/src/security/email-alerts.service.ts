import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SEND_TIMEOUT_MS = 8000;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sends critical security alerts by email (Resend, https://resend.com), so a
 * break-in attempt reaches the admins even when nobody has the app open.
 *
 * Configured by environment variables only — RESEND_API_KEY, ALERT_EMAIL_FROM
 * (a sender on a domain verified in Resend) and, optionally, ALERT_EMAILS for
 * extra recipients on top of the super admins' own addresses. Without
 * RESEND_API_KEY it does nothing, so development needs no setup.
 *
 * It never throws: an email outage must not break the action that raised the alert.
 */
@Injectable()
export class EmailAlertsService {
  private readonly logger = new Logger(EmailAlertsService.name);

  constructor(private config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<string>('RESEND_API_KEY') && !!this.config.get<string>('ALERT_EMAIL_FROM');
  }

  extraRecipients(): string[] {
    return (this.config.get<string>('ALERT_EMAILS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  async send(to: string[], subject: string, text: string): Promise<boolean> {
    const recipients = Array.from(new Set(to.map((e) => e.trim().toLowerCase()).filter(Boolean)));
    if (!this.enabled || recipients.length === 0) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get<string>('ALERT_EMAIL_FROM'),
          to: recipients,
          subject,
          text,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2 style="color:#b91c1c">${escapeHtml(subject)}</h2><p style="white-space:pre-line">${escapeHtml(text)}</p><hr><p style="color:#6b7280;font-size:12px">Alerte automatique ScanLinkPay. Ouvrez l'administration (Alertes de sécurité) pour agir.</p></div>`,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.error(`Resend refused the alert email (${res.status}): ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Could not send the alert email: ${err?.name === 'AbortError' ? 'timeout' : err?.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
