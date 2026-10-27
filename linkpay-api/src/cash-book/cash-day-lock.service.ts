import { ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { trustedNow } from '../common/utils/trusted-clock';
import { addDaysToKey, businessDayKey, businessDayRange } from '../common/utils/business-day';

export const CASH_DAY_CLOSED = 'CASH_DAY_CLOSED';
export const CASH_PREVIOUS_DAY_UNCLOSED = 'CASH_PREVIOUS_DAY_UNCLOSED';

/** Without any closing yet, only the recent past is looked at (the first closing then sets the baseline). */
const FIRST_CLOSING_LOOKBACK_DAYS = 7;
const ROWS = 2000;

/**
 * A closed day means the shop is closed: no sale, no till opening, no cash movement on that station for that day
 * until it is unlocked (emergency unlock by the seller with their secret code, or reopened by the manager).
 * Conversely, an earlier day that had activity and was never closed blocks today's operations until it is closed.
 * Kept apart from CashBookService so that Sales, Pos and CashRegister can use it without importing the whole book.
 */
@Injectable()
export class CashDayLockService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /**
   * Throws if the station may not operate today in `currency` (or in any currency when omitted):
   * an earlier day is still to be closed (CASH_PREVIOUS_DAY_UNCLOSED), or today itself is closed (CASH_DAY_CLOSED).
   */
  async assertDayOpen(merchantId: string, currency?: string): Promise<void> {
    const today = businessDayKey(trustedNow());
    for (const cur of currency ? [currency] : ['CDF', 'USD']) {
      const past = await this.earliestUnclosedPastDay(merchantId, cur, today);
      if (past) {
        throw new ForbiddenException({
          statusCode: 403,
          code: CASH_PREVIOUS_DAY_UNCLOSED,
          message: `Clôturez d'abord la caisse du ${past} avant de faire des opérations aujourd'hui.`,
          day: past,
          currency: cur,
          merchant_id: merchantId,
        });
      }
    }
    let q = this.db.from('cash_day_closings').select('id').eq('merchant_id', merchantId).eq('business_day', today).eq('status', 'closed').limit(1);
    if (currency) q = q.eq('currency', currency);
    const { data } = await q;
    if (data && data.length) {
      throw new ForbiddenException({
        statusCode: 403,
        code: CASH_DAY_CLOSED,
        message: 'La caisse du jour est clôturée. En cas d’urgence, déverrouillez-la avec votre code secret.',
        closing_id: data[0].id,
        merchant_id: merchantId,
      });
    }
  }

  /**
   * The earliest day before `today` with activity that was never closed.
   * After a first closing: the first active day after the last closed day. Before any closing: the latest active day of
   * the last week (it becomes the baseline, the first closing declares its opening).
   */
  async earliestUnclosedPastDay(merchantId: string, currency: string, today: string): Promise<string | null> {
    const { data } = await this.db.from('cash_day_closings')
      .select('business_day')
      .eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'closed').lt('business_day', today)
      .order('business_day', { ascending: false }).limit(1);
    const lastClosed: string | undefined = (data || [])[0]?.business_day;
    if (lastClosed) {
      const first = addDaysToKey(lastClosed, 1);
      if (first >= today) return null; // yesterday is closed: nothing to look at
      return (await this.activeDays(merchantId, currency, first, today))[0] || null;
    }
    const days = await this.activeDays(merchantId, currency, addDaysToKey(today, -FIRST_CLOSING_LOOKBACK_DAYS), today);
    return days.length ? days[days.length - 1] : null;
  }

  /** Business days in [fromDay, toDay) on which the station took or paid something in `currency` (sorted, unique). */
  async activeDays(merchantId: string, currency: string, fromDay: string, toDay: string): Promise<string[]> {
    const from = businessDayRange(fromDay).from.toISOString();
    const to = businessDayRange(toDay).from.toISOString();
    const [tickets, sales, movements, expenses] = await Promise.all([
      this.db.from('pos_tickets').select('paid_at').eq('merchant_id', merchantId).eq('status', 'paid').eq('currency', currency)
        .gte('paid_at', from).lt('paid_at', to).limit(ROWS),
      this.db.from('sales').select('paid_at').eq('merchant_id', merchantId).eq('status', 'PAID').eq('currency', currency)
        .gte('paid_at', from).lt('paid_at', to).limit(ROWS),
      this.db.from('cash_movements').select('created_at, cash_register_sessions!inner(merchant_id, currency)')
        .eq('cash_register_sessions.merchant_id', merchantId).eq('cash_register_sessions.currency', currency)
        .gte('created_at', from).lt('created_at', to).limit(ROWS),
      this.db.from('organization_expenses').select('created_at, approved_at').eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'approved')
        .or(`and(approved_at.gte.${from},approved_at.lt.${to}),and(approved_at.is.null,created_at.gte.${from},created_at.lt.${to})`).limit(ROWS),
    ]);
    const days = new Set<string>();
    for (const t of tickets.data || []) if (t.paid_at) days.add(businessDayKey(t.paid_at));
    for (const s of sales.data || []) if (s.paid_at) days.add(businessDayKey(s.paid_at));
    for (const m of movements.data || []) if (m.created_at) days.add(businessDayKey(m.created_at));
    for (const e of expenses.data || []) if (e.approved_at || e.created_at) days.add(businessDayKey(e.approved_at || e.created_at));
    return [...days].sort();
  }
}
