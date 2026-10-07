import { useQueries, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type Currency = 'CDF' | 'USD';

export type HomeDay = { date: string; revenue: number };
export type HomeTop = { name: string; qty: number; revenue: number };
export type HomeSale = { id: string; label: string; at: string; method?: string | null; amount: number };

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
export function useHomeData(org: any, merchants: any[] | undefined, currency: Currency): HomeData {
  const usesPos = org?.sector === 'supermarche';
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
  const salesWeek = useQuery({
    queryKey: ['home-sales-week', org?.id, today],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/stats`, { params: { from, to } })).data,
    enabled: !!org?.id && !usesPos,
  });
  const salesToday = useQuery({
    queryKey: ['home-sales-today', org?.id, today],
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return (await api.get(`/organizations/${org.id}/sales/stats`, { params: { from: start.toISOString(), to } })).data;
    },
    enabled: !!org?.id && !usesPos,
  });
  const salesRecent = useQuery({
    queryKey: ['home-sales-recent', org?.id, today],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/history`, { params: { from, to } })).data,
    enabled: !!org?.id && !usesPos,
  });

  const byDay: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const countByDay: Record<string, number> = {};
  const top = new Map<string, HomeTop>();
  let recent: HomeSale[] = [];
  let held = 0;
  let loading: boolean;

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
        });
      }
      held += (heldQ?.data as any)?.total || 0;
    }
  } else {
    loading = (salesWeek.isLoading && !salesWeek.data) || (salesToday.isLoading && !salesToday.data);
    for (const d of (salesWeek.data?.daily || []) as any[]) {
      if (d.day in byDay) byDay[d.day] += d[currency] || 0;
    }
    for (const p of (salesWeek.data?.top_products || []) as any[]) {
      top.set(p.name, { name: p.name, qty: p.quantity, revenue: p.revenue?.[currency] || 0 });
    }
    recent = ((Array.isArray(salesRecent.data) ? salesRecent.data : salesRecent.data?.data) || [])
      .filter((s: any) => s.status === 'paid' && s.currency === currency)
      .map((s: any) => ({ id: s.id, label: s.reference || 'Vente', at: s.paid_at || s.created_at, method: s.payment_method, amount: s.total_cents }));
  }

  recent = recent.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 5);

  return {
    loading,
    today: {
      revenue: byDay[today],
      count: usesPos ? countByDay[today] || 0 : salesToday.data?.sales_count ?? null,
    },
    yesterday: { revenue: byDay[keys[5]] },
    days: keys.map((date) => ({ date, revenue: byDay[date] })),
    top: [...top.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 3),
    recent,
    held,
  };
}
