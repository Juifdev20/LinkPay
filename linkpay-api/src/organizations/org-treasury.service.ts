import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { sumByCurrency } from '../common/utils/currency';
import { trustedNow } from '../common/utils/trusted-clock';
import { treasuryPasswordIssue } from './treasury-password';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const TOKEN_MINUTES = 15;
const PAGE = 1000;

type Money = { CDF: number; USD: number };

export interface TreasuryStationRow {
  merchant_id: string | null;
  merchant_name: string;
  collected: Money;
  expenses: Money;
  net: Money;
}

/**
 * The owner's "Trésorerie" (general cash desk): what every station collected, what was spent,
 * and what is really left. It only READS the sales/tickets/expenses already recorded — it never
 * writes money. The screen is behind its own password (separate from the stock one); a correct
 * password gives a short-lived token that the data endpoint requires.
 */
@Injectable()
export class OrgTreasuryService {
  constructor(
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {}

  private db() {
    return this.supabaseService.getClient();
  }

  async status(orgId: string): Promise<{ is_set: boolean; locked_until: string | null }> {
    const { data } = await this.db()
      .from('organizations')
      .select('treasury_password_hash, treasury_password_locked_until')
      .eq('id', orgId)
      .single();
    const lockedUntil = data?.treasury_password_locked_until;
    return {
      is_set: !!data?.treasury_password_hash,
      locked_until: lockedUntil && new Date(lockedUntil) > trustedNow() ? lockedUntil : null,
    };
  }

  /** First entry: the owner chooses the password (typed twice). Refused once one exists. */
  async createPassword(orgId: string, password: string, confirm: string): Promise<void> {
    if ((await this.status(orgId)).is_set) {
      throw new BadRequestException('Le mot de passe trésorerie est déjà défini.');
    }
    if (password !== confirm) throw new BadRequestException('Les deux mots de passe ne sont pas identiques.');
    const issue = treasuryPasswordIssue(password);
    if (issue) throw new BadRequestException(issue);
    await this.store(orgId, password);
  }

  /** Changes it, after proving the current one. */
  async changePassword(orgId: string, current: string, password: string, confirm: string): Promise<void> {
    await this.checkPassword(orgId, current);
    if (password !== confirm) throw new BadRequestException('Les deux mots de passe ne sont pas identiques.');
    const issue = treasuryPasswordIssue(password);
    if (issue) throw new BadRequestException(issue);
    await this.store(orgId, password);
  }

  /** Checks the password (5 tries then 15 min lock) and returns the short-lived token. */
  async unlock(orgId: string, userId: string, password: string): Promise<{ token: string; expires_in: number }> {
    await this.checkPassword(orgId, password);
    const expiresIn = TOKEN_MINUTES * 60;
    return { token: this.sign(orgId, userId, trustedNow().getTime() + expiresIn * 1000), expires_in: expiresIn };
  }

  assertToken(orgId: string, userId: string, token: string | undefined): void {
    if (!token) throw new ForbiddenException('TREASURY_LOCKED');
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new ForbiddenException('TREASURY_LOCKED');
    const expected = this.signature(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('TREASURY_LOCKED');
    let payload: { o: string; u: string; exp: number; t: string };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new ForbiddenException('TREASURY_LOCKED');
    }
    if (payload.t !== 'treasury' || payload.o !== orgId || payload.u !== userId || payload.exp < trustedNow().getTime()) {
      throw new ForbiddenException('TREASURY_LOCKED');
    }
  }

  /** Collected (till tickets + Ventes sales), spent (organization expenses) and the real cash left, per station. */
  async overview(orgId: string): Promise<{ stations: TreasuryStationRow[]; totals: { collected: Money; expenses: Money; net: Money } }> {
    const { data: merchants, error } = await this.db().from('merchants').select('id, name').eq('organization_id', orgId);
    if (error) throw new Error(`Failed to load stations: ${error.message}`);
    const ids = (merchants || []).map((m: any) => m.id as string);

    const [tickets, sales, expenses] = await Promise.all([
      ids.length
        ? this.fetchAll((from, to) => this.db().from('pos_tickets').select('merchant_id, total_cents, currency').in('merchant_id', ids).eq('status', 'paid').range(from, to))
        : Promise.resolve([] as any[]),
      this.fetchAll((from, to) => this.db().from('sales').select('merchant_id, total_cents, currency').eq('organization_id', orgId).eq('status', 'PAID').range(from, to)),
      this.fetchAll((from, to) => this.db().from('organization_expenses').select('merchant_id, amount_cents, currency').eq('organization_id', orgId).eq('status', 'approved').range(from, to)),
    ]);

    const rowFor = (merchantId: string | null, name: string): TreasuryStationRow => {
      const collected = sumByCurrency([...tickets, ...sales].filter((t) => (t.merchant_id ?? null) === merchantId), 'total_cents');
      const spent = sumByCurrency(expenses.filter((e) => (e.merchant_id ?? null) === merchantId), 'amount_cents');
      return {
        merchant_id: merchantId,
        merchant_name: name,
        collected,
        expenses: spent,
        net: { CDF: collected.CDF - spent.CDF, USD: collected.USD - spent.USD },
      };
    };

    const stations = (merchants || []).map((m: any) => rowFor(m.id, m.name));
    // Expenses recorded without a station (or for a station since removed) still weigh on the cash.
    const known = new Set(ids);
    const loose = expenses.filter((e) => !e.merchant_id || !known.has(e.merchant_id));
    if (loose.length) {
      const spent = sumByCurrency(loose, 'amount_cents');
      stations.push({
        merchant_id: null,
        merchant_name: 'Sans station',
        collected: { CDF: 0, USD: 0 },
        expenses: spent,
        net: { CDF: 0 - spent.CDF || 0, USD: 0 - spent.USD || 0 },
      });
    }

    const add = (pick: (r: TreasuryStationRow) => Money): Money =>
      stations.reduce((acc, r) => ({ CDF: acc.CDF + pick(r).CDF, USD: acc.USD + pick(r).USD }), { CDF: 0, USD: 0 });
    return { stations, totals: { collected: add((r) => r.collected), expenses: add((r) => r.expenses), net: add((r) => r.net) } };
  }

  private async store(orgId: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, 10);
    const { error } = await this.db()
      .from('organizations')
      .update({ treasury_password_hash: hash, treasury_password_attempts: 0, treasury_password_locked_until: null })
      .eq('id', orgId);
    if (error) throw new Error(`Failed to set treasury password: ${error.message}`);
  }

  private async checkPassword(orgId: string, password: string): Promise<void> {
    const { data: org } = await this.db()
      .from('organizations')
      .select('treasury_password_hash, treasury_password_attempts, treasury_password_locked_until')
      .eq('id', orgId)
      .single();
    if (!org?.treasury_password_hash) throw new BadRequestException("Aucun mot de passe trésorerie n'est défini.");

    const now = trustedNow();
    if (org.treasury_password_locked_until && new Date(org.treasury_password_locked_until) > now) {
      const minutesLeft = Math.ceil((new Date(org.treasury_password_locked_until).getTime() - now.getTime()) / 60000);
      throw new ForbiddenException(`Trop de tentatives échouées. Réessayez dans ${minutesLeft} min.`);
    }

    if (!password || !(await bcrypt.compare(password, org.treasury_password_hash))) {
      const attempts = (org.treasury_password_attempts || 0) + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      await this.db()
        .from('organizations')
        .update({
          treasury_password_attempts: locked ? 0 : attempts,
          treasury_password_locked_until: locked ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        })
        .eq('id', orgId);
      if (locked) throw new ForbiddenException(`Trop de tentatives échouées. Trésorerie verrouillée ${LOCKOUT_MINUTES} min.`);
      throw new BadRequestException(`Mot de passe incorrect (${MAX_ATTEMPTS - attempts} tentative(s) restante(s)).`);
    }

    if (org.treasury_password_attempts) {
      await this.db()
        .from('organizations')
        .update({ treasury_password_attempts: 0, treasury_password_locked_until: null })
        .eq('id', orgId);
    }
  }

  private sign(orgId: string, userId: string, exp: number): string {
    const body = Buffer.from(JSON.stringify({ t: 'treasury', o: orgId, u: userId, exp })).toString('base64url');
    return `${body}.${this.signature(body)}`;
  }

  private signature(body: string): string {
    const secret = this.configService.get<string>('JWT_SECRET') || '';
    // A key of its own, derived from the server secret: a treasury token is never a login token.
    const key = createHash('sha256').update(`treasury:${secret}`).digest();
    return createHmac('sha256', key).update(body).digest('base64url');
  }

  /** Reads every row of a query, 1000 at a time (Supabase caps one answer). */
  private async fetchAll(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await page(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to load treasury figures: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
}
