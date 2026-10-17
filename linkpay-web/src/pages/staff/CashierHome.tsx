import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { HomeHero, QuickActions, SalesChart, RecentSales, Skeleton, type QuickAction } from '@/components/home/HomeWidgets';
import type { Currency, HomeDay, HomeSale } from '@/components/home/useHomeData';
import { ShoppingCart, PauseCircle, ScanLine, QrCode, Vault, ChevronRight, AlertTriangle } from 'lucide-react';

/** Local calendar day as YYYY-MM-DD. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The cashier's paid tickets of the last 7 days, all pages (the API returns their own tickets only). */
async function fetchMyWeek(stationId: string, from: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await api.get(`/merchants/${stationId}/pos/tickets`, { params: { status: 'paid', from, page, limit: 100 } });
    all.push(...(data.data || []));
    if (all.length >= (data.total || 0) || !(data.data || []).length) break;
  }
  return all;
}

/**
 * The cashier's home: their own day at a glance — what they sold today and
 * this week, their till (float, cash taken, what the drawer should hold) and
 * their latest tickets. Only their own sales: the station's totals and
 * margins are the manager's and the owner's. Selling itself is the "Vente" tab.
 */
export default function CashierHome() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [currency, setCurrencyState] = useState<Currency>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem('pos-currency', c); } catch { /* not persisted */ }
  };

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });
  // A staff member only gets their own station back.
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });
  const stationId = user?.station_id || stations?.[0]?.id;

  // ---- The 7-day window, today last ----
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return dayKey(d);
  });
  const todayKey = keys[6];

  const { data: tickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ['cashier-week', stationId, todayKey],
    queryFn: () => fetchMyWeek(stationId!, start.toISOString()),
    enabled: !!stationId,
  });

  // ---- The till (same queries as the POS screen, so the cache is shared) ----
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['cash-session', stationId, currency],
    queryFn: async () => (await api.get(`/merchants/${stationId}/cash-register/sessions/current`, { params: { currency } })).data,
    enabled: !!stationId,
  });
  const session = sessionData?.session;
  const { data: sessionDetail } = useQuery({
    queryKey: ['cash-session-detail', session?.id],
    queryFn: async () => (await api.get(`/merchants/${stationId}/cash-register/sessions/${session.id}`)).data,
    enabled: !!session?.id,
  });
  const { data: heldData } = useQuery({
    queryKey: ['pos-held', stationId],
    queryFn: async () => (await api.get(`/merchants/${stationId}/pos/tickets`, { params: { status: 'open', held: true, limit: 50 } })).data,
    enabled: !!stationId && !!session,
  });
  const held = heldData?.total || 0;

  // Articles at or under their alert level — whenever they got there. Same
  // query as the till's catalog, so it's usually already in the cache.
  const { data: catalog } = useQuery({
    queryKey: ['pos-catalog', stationId],
    queryFn: async () => (await api.get(`/merchants/${stationId}/stock-items`)).data as any[],
    enabled: !!stationId,
  });
  const lowStock = (catalog || [])
    .filter((i) => i.quantity <= (i.low_stock_threshold ?? 5))
    .sort((a, b) => a.quantity - b.quantity);

  // ---- Aggregation, in the chosen currency ----
  const mine = (tickets || []).filter((t) => t.currency === currency && t.paid_at);
  const byDay: Record<string, { revenue: number; count: number }> = Object.fromEntries(keys.map((k) => [k, { revenue: 0, count: 0 }]));
  for (const t of mine) {
    const k = dayKey(new Date(t.paid_at));
    if (byDay[k]) {
      byDay[k].revenue += t.total_cents || 0;
      byDay[k].count += 1;
    }
  }
  const days: HomeDay[] = keys.map((k) => ({ date: k, revenue: byDay[k].revenue }));
  const recent: HomeSale[] = [...mine]
    .sort((a, b) => (b.paid_at > a.paid_at ? 1 : -1))
    .slice(0, 5)
    .map((t) => ({ id: t.id, label: `Ticket #${t.ticket_number ?? '—'}`, at: t.paid_at, method: t.payment_method, amount: t.total_cents }));
  const loading = !stationId || ticketsLoading;

  const actions: QuickAction[] = [
    { label: 'Vendre', icon: ShoppingCart, onClick: () => navigate('/dashboard/pos'), tone: 'bg-primary text-primary-foreground shadow-primary/30' },
    { label: held ? `En attente (${held})` : 'En attente', icon: PauseCircle, onClick: () => navigate('/dashboard/pos?onglet=attente'), tone: 'bg-amber-500/15 text-amber-600' },
    { label: 'Carte', icon: ScanLine, onClick: () => navigate('/dashboard/card/charge'), tone: 'bg-emerald-500/15 text-emerald-600' },
    { label: 'Recevoir', icon: QrCode, onClick: () => navigate('/dashboard/organization/receive'), tone: 'bg-sky-500/15 text-sky-600' },
  ];

  const place = [org?.name, user?.station_name || stations?.[0]?.name].filter(Boolean).join(' · ');

  return (
    <div className="px-4 pt-4 pb-28 md:pb-6 lg:p-6 space-y-5 max-w-6xl mx-auto">
      <HomeHero
        firstName={user?.full_name?.split(' ')[0]}
        orgName={place}
        currency={currency}
        onCurrency={setCurrency}
        today={{ revenue: byDay[todayKey].revenue, count: byDay[todayKey].count }}
        yesterday={{ revenue: byDay[keys[5]].revenue }}
        loading={loading}
        onOpenTill={() => navigate('/dashboard/pos')}
      />

      <QuickActions actions={actions} />

      {/* My till */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${session ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            <Vault className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Ma caisse {currency}</p>
            <p className="text-xs text-muted-foreground">
              {sessionLoading
                ? 'Chargement…'
                : session
                  ? `Ouverte depuis ${new Date(session.opened_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Fermée — ouvrez-la pour commencer à vendre'}
            </p>
          </div>
          {session ? (
            <Button size="sm" variant="ghost" onClick={() => navigate('/dashboard/pos?onglet=caisse')}>
              Détails <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            !sessionLoading && <Button size="sm" onClick={() => navigate('/dashboard/pos')}>Ouvrir</Button>
          )}
        </div>
        {session && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Fond de caisse', value: session.opening_float_cents },
              { label: 'Ventes espèces', value: sessionDetail?.cash_sales_cents },
              { label: 'Attendu au tiroir', value: sessionDetail?.expected_cents },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-muted/50 px-2 py-2.5">
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                {s.value === undefined ? (
                  <Skeleton className="mx-auto mt-1 h-4 w-16" />
                ) : (
                  <p className="mt-0.5 text-sm font-bold text-foreground [overflow-wrap:anywhere]">{formatCurrency(s.value || 0, currency)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Low stock: the cashier sees the shelf empty first and reminds the manager or the owner. */}
      {lowStock.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {lowStock.length} produit{lowStock.length > 1 ? 's' : ''} en stock bas — prévenez le gérant ou le magasinier
            </p>
          </div>
          <ul className="mt-3 divide-y divide-amber-200 dark:divide-amber-900">
            {lowStock.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">{i.name}</span>
                {i.quantity <= 0 ? (
                  <span className="flex-shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">Rupture</span>
                ) : (
                  <span className="flex-shrink-0 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    {i.quantity} restant{i.quantity > 1 ? 's' : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {lowStock.length > 6 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">… et {lowStock.length - 6} autre{lowStock.length - 6 > 1 ? 's' : ''}.</p>
          )}
        </div>
      )}

      <div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0 lg:items-start">
        <SalesChart days={days} currency={currency} loading={loading} />
        <RecentSales sales={recent} currency={currency} loading={loading} moreTo="/dashboard/pos?onglet=ventes" />
      </div>
    </div>
  );
}
