import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';

const PERIODS = [
  { key: '1m', label: 'Ce mois' },
  { key: '3m', label: '3 mois' },
  { key: '6m', label: '6 mois' },
] as const;

const COLORS: Record<string, string> = {
  transfer: '#4f6bff',
  merchant_payment: '#f59e0b',
  withdrawal: '#f43f5e',
  subscription: '#0ea5ff',
  other: '#94a3b8',
};

type Spending = { total_cents: number; categories: { key: string; label: string; amount_cents: number; percent: number }[] };

/**
 * "Dépenses par catégorie": what left the wallet (transfers, merchant payments, withdrawals…), computed from the
 * wallet's own history — a donut with the total in the middle and the legend underneath, as in the design.
 */
export function SpendingOverview() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('1m');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const { data, isLoading } = useQuery<Spending>({
    queryKey: ['wallet-spending', period, currency],
    queryFn: async () => (await api.get('/wallet/spending', { params: { period, currency } })).data,
  });

  const total = data?.total_cents || 0;
  const cats = data?.categories || [];
  // Donut: one stroke arc per category on a circle of circumference 100.
  let offset = 0;
  const arcs = cats.map((c) => {
    const arc = { key: c.key, len: Math.max(0.0001, (c.amount_cents / (total || 1)) * 100), off: offset };
    offset += arc.len;
    return arc;
  });
  const whole = (cents: number) => formatCurrency(cents, currency).replace(/,00(?=\s)/, '');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn('rounded-full py-2 text-xs font-semibold transition-all', period === p.key ? 'bg-brand-gradient text-white shadow-brand' : 'text-muted-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-bold text-foreground">Dépenses par catégorie</p>
          <div className="inline-flex rounded-full bg-muted p-0.5">
            {(['CDF', 'USD'] as const).map((c) => (
              <button key={c} onClick={() => setCurrency(c)} className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', currency === c ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mx-auto my-5 h-44 w-44">
          <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
            <circle cx="21" cy="21" r="15.915" fill="none" strokeWidth="6" className="stroke-muted" />
            {!isLoading && arcs.map((a) => (
              <circle
                key={a.key}
                cx="21"
                cy="21"
                r="15.915"
                fill="none"
                stroke={COLORS[a.key] || COLORS.other}
                strokeWidth="6"
                strokeDasharray={`${a.len} ${100 - a.len}`}
                strokeDashoffset={-a.off}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-xl font-extrabold leading-tight text-foreground">{isLoading ? '…' : whole(total).replace(/\s(CDF|\$US)$/, '')}</span>
            <span className="text-xs font-semibold text-muted-foreground">{currency === 'USD' ? '$US' : 'CDF'}</span>
          </div>
        </div>

        {cats.length ? (
          <div className="divide-y divide-border">
            {cats.map((c) => (
              <div key={c.key} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: COLORS[c.key] || COLORS.other }} />
                <span className="flex-1 font-medium text-foreground">{c.label}</span>
                <span className="w-12 text-right text-muted-foreground tabular-nums">{c.percent.toLocaleString('fr-FR')} %</span>
                <span className="w-28 text-right font-semibold text-foreground tabular-nums">{whole(c.amount_cents)}</span>
              </div>
            ))}
          </div>
        ) : (
          !isLoading && <p className="text-center text-sm text-muted-foreground">Aucune dépense sur cette période.</p>
        )}
      </div>
    </div>
  );
}
