import { useMemo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card } from '@/components/ui/card';
import { formatCurrency, cn } from '@/lib/utils';
import { TrendingUp, Percent, Receipt, Trophy, Wallet, PiggyBank, ShoppingCart } from 'lucide-react';
import { getCategoryLabel } from '@/lib/stock-categories';
import { PRESETS, presetRange, type Preset } from '@/pages/organization/Transactions';
import { isSupermarket } from '@/lib/sectors';

type Money = { CDF?: number; USD?: number };
type Currency = 'CDF' | 'USD';

const CURRENCIES: Currency[] = ['CDF', 'USD'];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

function KpiAmounts({ amounts, color }: { amounts?: Money; color?: string }) {
  const present = CURRENCIES.filter((c) => amounts?.[c]);
  const shown = present.length ? present : ['USD' as Currency];
  return (
    <div className="space-y-0.5">
      {shown.map((c) => (
        <p key={c} className={cn('text-[15px] font-bold leading-tight [overflow-wrap:anywhere]', color || 'text-foreground')}>
          {formatCurrency(amounts?.[c] || 0, c)}
        </p>
      ))}
    </div>
  );
}

function pct(part?: number, total?: number) {
  if (!part || !total) return null;
  return Math.round((part / total) * 100);
}

const PERIOD_BUTTONS = PRESETS.filter((p) => p.value !== 'custom');

/**
 * Tableau de bord des ventes pour le vendeur et le comptable.
 * 'light' : volume et chiffre d'affaires uniquement (API ne renvoie pas les marges pour ce rôle).
 * 'full'  : toutes les KPI financières (marges brute/nette, frais).
 * Pour le secteur supermarché : mode POS — données agrégées depuis les caisses (merchants).
 */
export default function SalesDashboardPage({ variant = 'full' }: { variant?: 'full' | 'light' }) {
  const user = useAuthStore((s) => s.user);
  const [preset, setPreset] = useState<Preset>('today');
  const range = useMemo(() => presetRange(preset, ''), [preset]);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const isPos = isSupermarket(org?.sector);
  const showMargins = variant === 'full' && !isPos;

  // L'API POS exige from/to. La période "Tout" renvoie undefined/undefined :
  // on substitue une plage couvrant toute l'activité possible.
  const posRange = useMemo(() => {
    if (range.from && range.to) return range;
    return { from: new Date('2020-01-01').toISOString(), to: new Date(Date.now() + 86400000).toISOString() };
  }, [range]);

  // --- Mode Ventes (électronique, etc.) ---
  const { data: ventesStats, isLoading: ventesLoading } = useQuery({
    queryKey: ['org-sales-stats', org?.id, range.from, range.to],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/sales/stats`, { params: { from: range.from, to: range.to } })).data,
    enabled: !!org?.id && !isPos,
  });

  useRealtimeInvalidate(
    'sales',
    org?.id ? `organization_id=eq.${org.id}` : undefined,
    [['org-sales-stats', org?.id, range.from, range.to]],
    !!org?.id && !isPos,
  );

  // --- Mode POS (supermarché) ---
  const { data: merchants, isLoading: merchantsLoading } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id && isPos,
  });

  const storeIds: string[] = useMemo(() => (merchants || []).map((m: any) => m.id), [merchants]);

  // 4 queries per store: CDF-daily, CDF-top, USD-daily, USD-top
  // index formula: s * 4 + ci * 2 + type (0=daily, 1=top)
  const posQueries = useQueries({
    queries: (isPos && storeIds.length)
      ? storeIds.flatMap((id) =>
          CURRENCIES.flatMap((cur) => [
            {
              queryKey: ['pos-dash-daily', id, cur, posRange.from, posRange.to],
              queryFn: async () =>
                (await api.get(`/merchants/${id}/pos/stats/daily`, { params: { from: posRange.from, to: posRange.to, currency: cur } })).data,
            },
            {
              queryKey: ['pos-dash-top', id, cur, posRange.from, posRange.to],
              queryFn: async () =>
                (await api.get(`/merchants/${id}/pos/stats/top-products`, { params: { from: posRange.from, to: posRange.to, currency: cur, limit: 10 } })).data,
            },
          ])
        )
      : [],
  });

  const posLoading = merchantsLoading || posQueries.some((q) => q.isLoading && q.fetchStatus !== 'idle');

  // Aggregate POS queries → same shape as ventesStats
  const posStats = useMemo(() => {
    if (!isPos || !storeIds.length) return null;
    const revenue: Money = {};
    let sales_count = 0;
    const dailyMap: Record<string, Money> = {};
    // Merge top products by name across stores/currencies
    const topByCur: Record<Currency, Record<string, { name: string; quantity: number; revenue: number; category?: string }>> = { CDF: {}, USD: {} };

    storeIds.forEach((_, s) => {
      CURRENCIES.forEach((cur, ci) => {
        const dailyIdx = s * 4 + ci * 2 + 0;
        const topIdx = s * 4 + ci * 2 + 1;
        const dailyData: any[] | undefined = posQueries[dailyIdx]?.data;
        const topData: any[] | undefined = posQueries[topIdx]?.data;

        if (Array.isArray(dailyData)) {
          dailyData.forEach((d: any) => {
            if (!dailyMap[d.day]) dailyMap[d.day] = {};
            const amount = d.amount ?? d[cur] ?? 0;
            dailyMap[d.day][cur] = (dailyMap[d.day][cur] || 0) + amount;
            revenue[cur] = (revenue[cur] || 0) + amount;
            // Count tickets only once (from CDF to avoid double-counting split payments)
            if (ci === 0) sales_count += d.count ?? d.sales_count ?? 0;
          });
        }

        if (Array.isArray(topData)) {
          topData.forEach((p: any) => {
            const name: string = p.name || p.product_name || '?';
            if (!topByCur[cur][name]) topByCur[cur][name] = { name, quantity: 0, revenue: 0, category: p.category };
            topByCur[cur][name].quantity += p.quantity || 0;
            topByCur[cur][name].revenue += p.revenue ?? p.amount ?? 0;
          });
        }
      });
    });

    // Merge currencies into unified top_products
    const topMerged: Record<string, { name: string; quantity: number; revenue: Money; category?: string }> = {};
    CURRENCIES.forEach((cur) => {
      Object.values(topByCur[cur]).forEach((p) => {
        if (!topMerged[p.name]) topMerged[p.name] = { name: p.name, quantity: p.quantity, revenue: {}, category: p.category };
        else topMerged[p.name].quantity = Math.max(topMerged[p.name].quantity, p.quantity);
        topMerged[p.name].revenue[cur] = p.revenue;
      });
    });

    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, amounts]) => ({ day, ...amounts }));

    const top_products = Object.values(topMerged)
      .sort((a, b) => (b.revenue.CDF || b.revenue.USD || 0) - (a.revenue.CDF || a.revenue.USD || 0))
      .slice(0, 10);

    return { revenue, sales_count, daily, top_products };
  }, [isPos, storeIds, posQueries]);

  const stats = isPos ? posStats : ventesStats;
  const isLoading = isPos ? posLoading : ventesLoading;
  const hasSales =
    (stats?.sales_count || 0) > 0 ||
    (stats?.revenue && (Object.values(stats.revenue) as number[]).some((v) => v > 0));

  const firstName = user?.full_name?.split(' ')[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-28 md:pb-6 space-y-5">

      {/* En-tête */}
      <div>
        <h1 className="text-xl font-bold text-foreground">
          {greeting()}{firstName ? ` ${firstName}` : ''} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {org?.name || 'Tableau de bord ventes'}
        </p>
      </div>

      {/* Sélecteur de période */}
      <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
        {PERIOD_BUTTONS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
              preset === p.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Corps */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !hasSales ? (
        <div className="text-center py-16">
          <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">Aucune vente encaissée sur cette période.</p>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Chiffre d'affaires */}
            <Card className="p-3.5 shadow-card">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 bg-primary/10">
                <TrendingUp className="w-[18px] h-[18px] text-primary" />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chiffre d'affaires</p>
              <div className="mt-1"><KpiAmounts amounts={stats?.revenue as Money} /></div>
            </Card>

            {/* Tickets encaissés (POS) ou Marge brute (Ventes) */}
            {isPos ? (
              <Card className="p-3.5 shadow-card">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 bg-sky-500/10">
                  <ShoppingCart className="w-[18px] h-[18px] text-sky-600" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tickets encaissés</p>
                <p className="mt-1 text-[15px] font-bold leading-tight text-foreground">{stats?.sales_count ?? 0}</p>
              </Card>
            ) : showMargins ? (
              <Card className="p-3.5 shadow-card">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 bg-emerald-500/10">
                  <PiggyBank className="w-[18px] h-[18px] text-emerald-600" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Marge brute</p>
                <div className="mt-1"><KpiAmounts amounts={(stats as any)?.gross_margin as Money} /></div>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">Prix de vente − coût d'achat</p>
              </Card>
            ) : null}

            {showMargins && (
              <>
                <Card className="p-3.5 shadow-card">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 bg-sky-500/10">
                    <Wallet className="w-[18px] h-[18px] text-sky-600" />
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Marge nette</p>
                  <div className="mt-1"><KpiAmounts amounts={(stats as any)?.net_margin as Money} /></div>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">Après frais de plateforme</p>
                </Card>
                <Card className="p-3.5 shadow-card">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 bg-amber-500/10">
                    <Percent className="w-[18px] h-[18px] text-amber-600" />
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Frais de plateforme</p>
                  <div className="mt-1"><KpiAmounts amounts={(stats as any)?.fees as Money} /></div>
                </Card>
              </>
            )}
          </div>

          {/* Produits les plus vendus + Ventes par catégorie (mode Ventes seulement) */}
          <div className={cn('grid grid-cols-1 gap-5', !isPos && 'lg:grid-cols-2')}>

            <Card className="p-4 shadow-card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Trophy className="w-4 h-4 text-amber-600" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Produits les plus vendus</h2>
              </div>
              {!stats?.top_products?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">Aucun produit.</p>
              ) : (
                <div className="divide-y divide-border">
                  {stats.top_products.map((p: any, i: number) => (
                    <div key={p.name + i} className="flex items-center gap-3 py-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.quantity} vendu{p.quantity > 1 ? 's' : ''}
                          {!isPos && p.category ? ` · ${getCategoryLabel(p.category)}` : ''}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        {CURRENCIES.filter((c) => p.revenue?.[c]).map((c) => (
                          <p key={c} className="font-semibold text-foreground">{formatCurrency(p.revenue[c], c)}</p>
                        ))}
                        {showMargins && CURRENCIES.filter((c) => p.margin?.[c] !== undefined).map((c) => (
                          <p key={c} className="text-emerald-600 dark:text-emerald-400">marge {formatCurrency(p.margin[c], c)}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Ventes / Marge par catégorie — mode Ventes seulement */}
            {!isPos && (
              <Card className="p-4 shadow-card">
                <h2 className="text-sm font-semibold text-foreground mb-3">
                  {showMargins ? 'Marge par catégorie' : 'Ventes par catégorie'}
                </h2>
                {!(stats as any)?.by_category?.length ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Aucune catégorie.</p>
                ) : (
                  <div className="space-y-4">
                    {(stats as any).by_category.map((c: any) => (
                      <div key={c.category}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-foreground">
                            {getCategoryLabel(c.category === 'sans_categorie' ? null : c.category)}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.quantity} unité{c.quantity > 1 ? 's' : ''}</p>
                        </div>
                        {CURRENCIES.filter((cur) => c.revenue?.[cur]).map((cur) => {
                          const margin = showMargins
                            ? pct(c.margin?.[cur], c.revenue[cur])
                            : pct(c.revenue[cur], stats?.revenue?.[cur]);
                          return (
                            <div key={cur} className="mb-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                <span>{formatCurrency(c.revenue[cur], cur)}</span>
                                <span>{showMargins ? `marge ${margin ?? 0}%` : `${margin ?? 0}% des ventes`}</span>
                              </div>
                              <div className="h-2 rounded-full bg-accent overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, margin ?? 0))}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* Évolution du chiffre d'affaires */}
          <Card className="p-4 shadow-card">
            <h2 className="text-sm font-semibold text-foreground mb-3">Évolution du chiffre d'affaires</h2>
            <div className="space-y-2">
              {(stats?.daily || []).map((d: any) => {
                const max = Math.max(...((stats?.daily || []) as any[]).map((x: any) => x.CDF || 0), 1);
                return (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{d.day}</span>
                    <div className="flex-1 h-3 rounded-full bg-accent overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((d.CDF || 0) / max) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-foreground w-32 text-right flex-shrink-0">
                      {(d.CDF || d.USD)
                        ? [d.CDF && formatCurrency(d.CDF, 'CDF'), d.USD && formatCurrency(d.USD, 'USD')].filter(Boolean).join(' · ')
                        : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
