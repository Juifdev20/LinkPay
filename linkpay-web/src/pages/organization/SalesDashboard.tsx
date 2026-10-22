import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card } from '@/components/ui/card';
import { formatCurrency, cn } from '@/lib/utils';
import { TrendingUp, Percent, Receipt, Trophy, Wallet, PiggyBank } from 'lucide-react';
import { getCategoryLabel } from '@/lib/stock-categories';
import { PRESETS, presetRange, type Preset } from '@/pages/organization/Transactions';

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
 */
export default function SalesDashboardPage({ variant = 'full' }: { variant?: 'full' | 'light' }) {
  const user = useAuthStore((s) => s.user);
  const showMargins = variant === 'full';
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
    { label: "Chiffre d'affaires", amounts: stats?.revenue as Money, icon: TrendingUp, iconBg: 'bg-primary/10', iconColor: 'text-primary' },
    ...(showMargins ? [
      { label: 'Marge brute', amounts: stats?.gross_margin as Money, icon: PiggyBank, note: "Prix de vente − coût d'achat", iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-600' },
      { label: 'Marge nette', amounts: stats?.net_margin as Money, icon: Wallet, note: 'Après frais de plateforme', iconBg: 'bg-sky-500/10', iconColor: 'text-sky-600' },
      { label: 'Frais de plateforme', amounts: stats?.fees as Money, icon: Percent, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-600' },
    ] : []),
  ];

  const hasSales = (stats?.sales_count || 0) > 0;
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
          {/* KPI cards — style MagasinierDashboard */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label} className="p-3.5 shadow-card">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2.5', k.iconBg)}>
                  <k.icon className={cn('w-[18px] h-[18px]', k.iconColor)} />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
                <div className="mt-1">
                  <KpiAmounts amounts={k.amounts} />
                </div>
                {k.note && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{k.note}</p>}
              </Card>
            ))}
          </div>

          {/* Produits les plus vendus + Ventes par catégorie */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Produits les plus vendus */}
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
                          {p.quantity} vendu{p.quantity > 1 ? 's' : ''} · {getCategoryLabel(p.category)}
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

            {/* Ventes / Marge par catégorie */}
            <Card className="p-4 shadow-card">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                {showMargins ? 'Marge par catégorie' : 'Ventes par catégorie'}
              </h2>
              {!stats?.by_category?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">Aucune catégorie.</p>
              ) : (
                <div className="space-y-4">
                  {stats.by_category.map((c: any) => (
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
                          : pct(c.revenue[cur], stats.revenue?.[cur]);
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
          </div>

          {/* Évolution du chiffre d'affaires */}
          <Card className="p-4 shadow-card">
            <h2 className="text-sm font-semibold text-foreground mb-3">Évolution du chiffre d'affaires</h2>
            <div className="space-y-2">
              {(stats?.daily || []).map((d: any) => {
                const max = Math.max(...(stats.daily || []).map((x: any) => x.CDF || 0), 1);
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
