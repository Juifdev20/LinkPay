import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SEND_TIMEOUT_MS = 8000;
const HOUR_MS = 3_600_000;
const DEFAULT_MAX_PER_HOUR = 10;
const MAX_SMS_LENGTH = 160;

export type SmsProvider = 'africastalking' | 'twilio';

/** "0812345678" is not routable: only full international numbers (+243…) are accepted. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.trim().replace(/[\s().-]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/**
 * One SMS segment is 160 GSM characters; an accent or an emoji switches the whole message to
 * UCS-2 (70 characters) and triples the price. Alerts are sent in plain ASCII.
 */
export function toSmsText(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= MAX_SMS_LENGTH ? plain : `${plain.slice(0, MAX_SMS_LENGTH - 3)}...`;
}

/**
 * Sends the most critical security alerts by SMS, so they reach an administrator who has no
 * data connection, no email open and a silent app. SMS is NOT confidential: the text only says
 * that something happened and to open the admin screen — never names, amounts or identifiers.
 *
 * Provider by environment (nothing is sent until one is configured):
 *   SMS_PROVIDER=africastalking  + AT_USERNAME, AT_API_KEY, [AT_SENDER_ID]   (strong in Africa)
 *   SMS_PROVIDER=twilio          + TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * Extra numbers on top of the super admins' own phone numbers: ALERT_SMS_TO.
 *
 * It never throws, and it has a spending brake: at most SMS_MAX_PER_HOUR messages per hour per
 * API instance (default 10), so someone who can trigger alerts cannot run up the bill.
 */
@Injectable()
export class SmsAlertsService {
  private readonly logger = new Logger(SmsAlertsService.name);
  private sentAt: number[] = [];

  constructor(private config: ConfigService) {}

  get provider(): SmsProvider | null {
    const p = (this.config.get<string>('SMS_PROVIDER') || '').trim().toLowerCase();
    if (p === 'africastalking' && this.config.get('AT_USERNAME') && this.config.get('AT_API_KEY')) return 'africastalking';
    if (p === 'twilio' && this.config.get('TWILIO_ACCOUNT_SID') && this.config.get('TWILIO_AUTH_TOKEN') && this.config.get('TWILIO_FROM')) return 'twilio';
    return null;
  }

  get enabled(): boolean {
    return this.provider !== null;
  }

  extraRecipients(): string[] {
    return (this.config.get<string>('ALERT_SMS_TO') || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  private withinBudget(count: number, now: number): boolean {
    const max = Number(this.config.get('SMS_MAX_PER_HOUR')) || DEFAULT_MAX_PER_HOUR;
    this.sentAt = this.sentAt.filter((t) => now - t < HOUR_MS);
    if (this.sentAt.length + count > max) return false;
    for (let i = 0; i < count; i++) this.sentAt.push(now);
    return true;
  }

  /** Returns how many numbers the provider accepted. */
  async send(to: string[], message: string, now = Date.now()): Promise<number> {
    const provider = this.provider;
    const numbers = Array.from(new Set(to.map(normalizePhone).filter((n): n is string => !!n)));
    if (!provider || numbers.length === 0) return 0;
    if (!this.withinBudget(numbers.length, now)) {
      this.logger.warn(`SMS alert not sent: hourly budget reached (SMS_MAX_PER_HOUR).`);
      return 0;
    }

    const text = toSmsText(message);
    let accepted = 0;
    // One request per number for Twilio (its API has no multi-recipient call); one for everybody on Africa's Talking.
    try {
      if (provider === 'africastalking') accepted = await this.sendAfricasTalking(numbers, text);
      else accepted = (await Promise.all(numbers.map((n) => this.sendTwilio(n, text)))).filter(Boolean).length;
    } catch (err: any) {
      this.logger.error(`Could not send the alert SMS: ${err?.message}`);
    }
    return accepted;
  }

  private async post(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Returns how many recipients Africa's Talking really accepted (it answers 201 even when some numbers are refused). */
  private async sendAfricasTalking(numbers: string[], text: string): Promise<number> {
    const username = this.config.get<string>('AT_USERNAME')!;
    const base = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const form = new URLSearchParams({ username, to: numbers.join(','), message: text });
    const from = this.config.get<string>('AT_SENDER_ID');
    if (from) form.set('from', from);
    const res = await this.post(`${base}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey: this.config.get<string>('AT_API_KEY')!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      this.logger.error(`Africa's Talking refused the alert SMS (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return 0;
    }
    let recipients: any[] | null = null;
    try {
      recipients = ((await res.json()) as any)?.SMSMessageData?.Recipients ?? null;
    } catch { /* unreadable body: trust the HTTP status */ }
    if (!Array.isArray(recipients)) return numbers.length;
    // statusCode 100 Processed, 101 Sent, 102 Queued are successes; anything else (403 InvalidPhoneNumber, 405 InsufficientBalance…) is not.
    const ok = recipients.filter((r) => [100, 101, 102].includes(Number(r?.statusCode))).length;
    const failed = recipients.filter((r) => ![100, 101, 102].includes(Number(r?.statusCode)));
    if (failed.length > 0) this.logger.error(`Africa's Talking did not accept ${failed.length} alert SMS: ${failed.map((r) => r?.status || r?.statusCode).join(', ')}`);
    return ok;
  }

  private async sendTwilio(to: string, text: string): Promise<boolean> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const auth = Buffer.from(`${sid}:${this.config.get<string>('TWILIO_AUTH_TOKEN')}`).toString('base64');
    const res = await this.post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: this.config.get<string>('TWILIO_FROM')!, Body: text }).toString(),
    });
    if (!res.ok) {
      this.logger.error(`Twilio refused the alert SMS (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  }
}
