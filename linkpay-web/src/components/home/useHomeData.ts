import { isSupermarket } from '@/lib/sectors';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type Currency = 'CDF' | 'USD';

export type HomeDay = { date: string; revenue: number };
export type HomeTop = { name: string; qty: number; revenue: number };
export type HomeSale = { id: string; label: string; at: string; method?: string | null; amount: number; currency?: string };

export type HomeData = {
  /** First load with nothing cached yet — show skeletons. */
  loading: boolean;
  today: { revenue: number; count: number | null };
  yesterday: { revenue: number };
  /** The last 7 local days, oldest first, today last (always 7 entries). */
  days: HomeDay[];
  top: HomeTop[];
  recent: HomeSale[];
  /** Parked till tickets (POS only). */
  held: number;
  /** What was spent (owner only; zero otherwise), the same 7 days as `days`. */
  expenses: { today: number; days: HomeDay[] };
};

export type HomeDataOptions = {
  /** The one station the owner looks at (null = all): narrows the Ventes sales and the expenses. */
  stationId?: string | null;
  /** Load the expenses curve (the owner's home). */
  withExpenses?: boolean;
};

/** Local calendar day as YYYY-MM-DD (what the stats endpoints group by). */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The 7-day window ending today, as local-midnight boundaries. */
function weekRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return dayKey(d);
  });
  return { from: start.toISOString(), to: end.toISOString(), keys };
}

/**
 * Everything the home dashboard shows, in one shape whatever the sector:
 * - supermarket → the till (POS) stats of every store, added together;
 * - other sectors → the Ventes module stats of the organization.
 * Only existing endpoints; everything goes through the persisted query
 * cache, so on launch the last figures show at once and then refresh.
 */
export function useHomeData(org: any, merchants: any[] | undefined, currency: Currency, options: HomeDataOptions = {}): HomeData {
  const { stationId = null, withExpenses = false } = options;
  const usesPos = isSupermarket(org?.sector);
  const { from, to, keys } = weekRange();
  // Recomputed every render; the query keys use the day, not the instant,
  // so the cache stays stable within a day.
  const today = keys[6];
  const storeIds: string[] = (merchants || []).map((m: any) => m.id);

  // ---------------- POS (supermarket) ----------------
  const posQueries = useQueries({
    queries: usesPos
      ? storeIds.flatMap((id) => [
          {
            queryKey: ['home-pos-daily', id, currency, today],
            queryFn: async () => (await api.get(`/merchants/${id}/pos/stats/daily`, { params: { from, to, currency } })).data as any[],
          },
          {
            queryKey: ['home-pos-top', id, currency, today],
            queryFn: async () => (await api.get(`/merchants/${id}/pos/stats/top-products`, { params: { from, to, currency, limit: 5 } })).data as any[],
          },
          {
            queryKey: ['home-pos-recent', id],
            queryFn: async () => (await api.get(`/merchants/${id}/pos/tickets`, { params: { status: 'paid', limit: 5 } })).data,
          },
          {
            queryKey: ['pos-held', id],
            queryFn: async () => (await api.get(`/merchants/${id}/pos/tickets`, { params: { status: 'open', held: true, limit: 50 } })).data,
          },
        ])
      : [],
  });

  // ---------------- Ventes module (other sectors) ----------------
  // The server cuts the days (business timezone) and answers "today" itself: the phone's clock is never used here.
  const salesWeek = useQuery({
    queryKey: ['home-sales-week', org?.id, stationId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/stats`, { params: { days: 7, ...(stationId ? { merchant_id: stationId } : {}) } })).data,
    enabled: !!org?.id && !usesPos,
    refetchOnMount: 'always',
  });
  const salesRecent = useQuery({
    queryKey: ['home-sales-recent', org?.id],
    // No date window: the newest sales come first, and the phone's clock must not hide any.
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/history`)).data,
    enabled: !!org?.id && !usesPos,
    refetchOnMount: 'always',
  });

  // What was spent, per business day (the server cuts the days), for the red curve and the hero.
  const expensesWeek = useQuery({
    queryKey: ['home-expenses', org?.id, stationId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/expenses/stats`, { params: { days: 7, ...(stationId ? { merchant_id: stationId } : {}) } })).data,
    enabled: !!org?.id && withExpenses,
    refetchOnMount: 'always',
  });

  const byDay: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const countByDay: Record<string, number> = {};
  const top = new Map<string, HomeTop>();
  let recent: HomeSale[] = [];
  let held = 0;
  let loading: boolean;
  let dayKeys = keys;
  let todayKey = today;
  let todayCount: number | null = null;

  if (usesPos) {
    loading = !merchants || posQueries.some((q) => q.isLoading && !q.data);
    for (let s = 0; s < storeIds.length; s++) {
      const [daily, topQ, recentQ, heldQ] = posQueries.slice(s * 4, s * 4 + 4);
      for (const d of (daily?.data as any[]) || []) {
        if (d.date in byDay) {
          byDay[d.date] += d.revenue_cents;
          countByDay[d.date] = (countByDay[d.date] || 0) + d.tickets;
        }
      }
      for (const p of (topQ?.data as any[]) || []) {
        const e = top.get(p.name) || { name: p.name, qty: 0, revenue: 0 };
        e.qty += p.qty;
        e.revenue += p.revenue_cents;
        top.set(p.name, e);
      }
      for (const t of ((recentQ?.data as any)?.data || []) as any[]) {
        if (t.currency !== currency) continue;
        recent.push({
          id: t.id,
          label: `Ticket #${t.ticket_number ?? '—'}`,
          at: t.paid_at || t.updated_at,
          method: t.payment_method,
          amount: t.total_cents,
          currency: t.currency,
        });
      }
      held += (heldQ?.data as any)?.total || 0;
    }
  } else {
    loading = salesWeek.isLoading && !salesWeek.data;
    // Days and "today" come from the server (see getStats `days`): same cut as the station chips.
    const serverKeys: string[] | undefined = salesWeek.data?.day_keys;
    if (serverKeys?.length) {
      dayKeys = serverKeys;
      todayKey = salesWeek.data.today_key ?? serverKeys[serverKeys.length - 1];
      for (const k of Object.keys(byDay)) delete byDay[k];
      for (const k of serverKeys) byDay[k] = 0;
    }
    for (const d of (salesWeek.data?.daily || []) as any[]) {
      if (d.day in byDay) byDay[d.day] += d[currency] || 0;
    }
    todayCount = salesWeek.data ? salesWeek.data.today?.sales_count ?? null : null;    for (const p of (salesWeek.data?.top_products || []) as any[]) {
      top.set(p.name, { name: p.name, qty: p.quantity, revenue: p.revenue?.[currency] || 0 });
    }
    recent = ((Array.isArray(salesRecent.data) ? salesRecent.data : salesRecent.data?.data) || [])
      .filter((s: any) => String(s.status).toUpperCase() === 'PAID' && s.currency === currency)
      .map((s: any) => ({ id: s.id, label: s.reference || 'Vente', at: s.paid_at || s.created_at, method: s.payment_method, amount: s.total_cents, currency: s.currency }));
  }

  const spentByDay: Record<string, number> = {};
  for (const d of (expensesWeek.data?.daily || []) as any[]) spentByDay[d.day] = d[currency] || 0;
  const expensesToday = expensesWeek.data?.today?.[currency] || 0;

  recent = recent.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5);

  return {
    loading,
    today: {
      revenue: byDay[todayKey] ?? 0,
      count: usesPos ? countByDay[todayKey] || 0 : todayCount,
    },
    yesterday: { revenue: byDay[dayKeys[dayKeys.length - 2]] ?? 0 },
    days: dayKeys.map((date) => ({ date, revenue: byDay[date] ?? 0 })),
    top: [...top.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 3),
    recent,
    held,
    expenses: {
      today: expensesToday,
      days: dayKeys.map((date) => ({ date, revenue: spentByDay[date] ?? 0 })),
    },
  };
}
