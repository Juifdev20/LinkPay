import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, cn } from '@/lib/utils';
import { TrendingUp, Percent, Receipt, Trophy, Wallet, PiggyBank } from 'lucide-react';
import { getCategoryLabel } from '@/lib/stock-categories';
import { PRESETS, presetRange, type Preset } from '@/pages/organization/Transactions';

type Money = { CDF?: number; USD?: number };
type Currency = 'CDF' | 'USD';

const CURRENCIES: Currency[] = ['CDF', 'USD'];

function KpiAmounts({ amounts }: { amounts?: Money }) {
  const present = CURRENCIES.filter((c) => amounts?.[c]);
  const shown = present.length ? present : ['USD' as Currency];
  return (
    <div>
      {shown.map((c) => (
        <p key={c} className="text-lg font-bold text-foreground leading-tight">
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

/**
 * Financial dashboard for the enterprise's sales: revenue, gross and net
 * margins, best sellers and margin by category. Every amount is shown per
 * currency (CDF and USD are never added together). Refreshes live when a
 * sale is paid, via the `sales` realtime channel.
 */
export default function SalesDashboardPage({ variant = 'full' }: { variant?: 'full' | 'light' }) {
  // 'light' (vendeur) shows volume and revenue only — margins and fees are
  // also stripped by the API for that role.
  const showMargins = variant === 'full';
  // Opens on today; the user picks another period from the chips.
  const [preset, setPreset] = useState<Preset>('today');
  const range = useMemo(() => presetRange(preset, ''), [preset]);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: stats, isLoading } = useQuery({
    queryKey: ['org-sales-stats', org?.id, range.from, range.to],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/sales/stats`, { params: { from: range.from, to: range.to } })).data,
    enabled: !!org?.id,
  });

  useRealtimeInvalidate(
    'sales',
    org?.id ? `organization_id=eq.${org.id}` : undefined,
    [['org-sales-stats', org?.id, range.from, range.to]],
    !!org?.id,
  );

  const kpis = [
    { label: "Chiffre d'affaires", amounts: stats?.revenue as Money, icon: TrendingUp },
    { label: 'Marge brute', amounts: stats?.gross_margin as Money, icon: PiggyBank, note: 'Prix de vente − coût d\'achat' },
    { label: 'Marge nette', amounts: stats?.net_margin as Money, icon: Wallet, note: 'Après frais de plateforme' },
    { label: 'Frais de plateforme', amounts: stats?.fees as Money, icon: Percent },
  ].filter((k) => showMargins || k.label === "Chiffre d'affaires");

  const hasSales = (stats?.sales_count || 0) > 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="sticky top-20 md:top-0 z-10 bg-background px-6 pt-6 pb-4 space-y-3">
        <PageHeader title="Tableau de bord ventes" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.filter((p) => p.value !== 'custom').map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', preset === p.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-10 space-y-6">
        {isLoading ? (
          <p className="text-muted-foreground text-center py-12">Chargement...</p>
        ) : !hasSales ? (
          <div className="text-center py-16">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">Aucune vente encaissée sur cette période.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {kpis.map((k) => (
                <Card key={k.label}>
                  <CardContent className="pt-5">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                      <k.icon className="w-4 h-4 text-primary" />
                    </div>
                    <KpiAmounts amounts={k.amounts} />
                    <p className="text-sm text-muted-foreground mt-1">{k.label}</p>
                    {k.note && <p className="text-xs text-muted-foreground/70 mt-0.5">{k.note}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-primary" />
                    Produits les plus vendus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.top_products.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun produit.</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.top_products.map((p: any, i: number) => (
                        <div key={p.name + i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.quantity} vendu{p.quantity > 1 ? 's' : ''} · {getCategoryLabel(p.category)}</p>
                          </div>
                          <div className="text-right text-xs">
                            {CURRENCIES.filter((c) => p.revenue?.[c]).map((c) => (
                              <p key={c} className="font-semibold text-foreground">{formatCurrency(p.revenue[c], c)}</p>
                            ))}
                            {CURRENCIES.filter((c) => p.margin?.[c] !== undefined).map((c) => (
                              <p key={c} className="text-success">marge {formatCurrency(p.margin[c], c)}</p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{showMargins ? 'Marge par catégorie' : 'Ventes par catégorie'}</CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.by_category.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune catégorie.</p>
                  ) : (
                    <div className="space-y-4">
                      {stats.by_category.map((c: any) => (
                        <div key={c.category}>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-semibold text-foreground">{getCategoryLabel(c.category === 'sans_categorie' ? null : c.category)}</p>
                            <p className="text-xs text-muted-foreground">{c.quantity} unité{c.quantity > 1 ? 's' : ''}</p>
                          </div>
                          {CURRENCIES.filter((cur) => c.revenue?.[cur]).map((cur) => {
                            const margin = showMargins ? pct(c.margin?.[cur], c.revenue[cur]) : pct(c.revenue[cur], stats.revenue?.[cur]);
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
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Évolution du chiffre d'affaires</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.daily.map((d: any) => {
                    const max = Math.max(...stats.daily.map((x: any) => x.CDF || 0), 1);
                    return (
                      <div key={d.day} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{d.day}</span>
                        <div className="flex-1 h-3 rounded-full bg-accent overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${((d.CDF || 0) / max) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-foreground w-32 text-right flex-shrink-0">
                          {(d.CDF || d.USD) ? [d.CDF && formatCurrency(d.CDF, 'CDF'), d.USD && formatCurrency(d.USD, 'USD')].filter(Boolean).join(' · ') : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
