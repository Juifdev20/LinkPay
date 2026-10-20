import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency, cn } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight, Banknote, CreditCard, Smartphone, Shuffle } from 'lucide-react';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type MethodFilter = '' | 'cash' | 'scanlinkpay' | 'mobile_money';

const METHODS: { value: MethodFilter; label: string; icon: typeof Banknote }[] = [
  { value: '', label: 'Tous', icon: Shuffle },
  { value: 'cash', label: 'Espèces', icon: Banknote },
  { value: 'scanlinkpay', label: 'ScanLinkPay', icon: CreditCard },
  { value: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
];

const METHOD_BADGE: Record<string, { label: string; cls: string }> = {
  cash: { label: 'Espèces', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  scanlinkpay: { label: 'ScanLinkPay', cls: 'bg-primary/10 text-primary' },
  mobile_money: { label: 'Mobile Money', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  mixed: { label: 'Mixte', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
};

/** All the cashier's paid tickets for [from, to) — the API returns their own tickets only. */
async function fetchMine(stationId: string, from: string, to: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const { data } = await api.get(`/merchants/${stationId}/pos/tickets`, { params: { status: 'paid', from, to, page, limit: 100 } });
    all.push(...(data.data || []));
    if (all.length >= (data.total || 0) || !(data.data || []).length) break;
  }
  return all;
}

/**
 * "Mes ventes" — the cashier's own monthly sales as a professional table:
 * header stats (total, espèces, ScanLinkPay, tickets), method filter chips,
 * and a list of individual tickets sorted newest-first.
 */
export default function MySalesPage() {
  const user = useAuthStore((s) => s.user);
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month…
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [method, setMethod] = useState<MethodFilter>('');

  const { from, to, label } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      label: start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  }, [offset]);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });
  const stationId = user?.station_id || stations?.[0]?.id;

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['my-sales', stationId, from],
    queryFn: () => fetchMine(stationId!, from, to),
    enabled: !!stationId,
  });

  // Base: all paid tickets in selected currency for this month
  const base = (tickets || []).filter((t) => t.currency === currency && t.paid_at);

  // Stats (always over the full month, not affected by method filter)
  const monthTotal = base.reduce((s, t) => s + (t.total_cents || 0), 0);
  const cashTotal = base.filter((t) => t.payment_method === 'cash').reduce((s, t) => s + (t.total_cents || 0), 0);
  const slpTotal = base.filter((t) => t.payment_method === 'scanlinkpay').reduce((s, t) => s + (t.total_cents || 0), 0);
  const monthCount = base.length;
  const activeDays = new Set(base.map((t) => dayKey(new Date(t.paid_at)))).size;

  // Table rows: filtered by method, sorted newest first
  const rows = [...base]
    .filter((t) => !method || t.payment_method === method)
    .sort((a, b) => (b.paid_at > a.paid_at ? 1 : -1));

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-2xl mx-auto">
      <PageHeader title="Mes ventes" />

      {/* Month navigation + currency toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            className="rounded-full p-2 hover:bg-accent transition-colors"
            aria-label="Mois précédent"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="min-w-[9rem] text-center text-sm font-semibold capitalize">{label}</p>
          <button
            className="rounded-full p-2 hover:bg-accent disabled:opacity-30 transition-colors"
            aria-label="Mois suivant"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                currency === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total du mois</p>
          <p className="mt-1 text-lg font-bold text-foreground [overflow-wrap:anywhere]">{formatCurrency(monthTotal, currency)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Tickets · Jours travaillés</p>
          <p className="mt-1 text-lg font-bold text-foreground">{monthCount} · {activeDays}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> Espèces
          </div>
          <p className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-400 [overflow-wrap:anywhere]">{formatCurrency(cashTotal, currency)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> ScanLinkPay
          </div>
          <p className="mt-1 text-base font-bold text-primary [overflow-wrap:anywhere]">{formatCurrency(slpTotal, currency)}</p>
        </div>
      </div>

      {/* Method filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {METHODS.map((m) => (
          <button
            key={m.value}
            onClick={() => setMethod(m.value)}
            className={cn(
              'flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              method === m.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* Ticket table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {isLoading || !stationId ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Aucune vente{method ? ` (${METHODS.find(m => m.value === method)?.label})` : ''} en {currency} ce mois-ci.
          </p>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
              <span>Ticket · Date</span>
              <span className="text-center">Mode</span>
              <span className="text-right">Montant</span>
            </div>
            {/* Table rows */}
            <div className="divide-y divide-border">
              {rows.map((t) => {
                const badge = METHOD_BADGE[t.payment_method as keyof typeof METHOD_BADGE];
                return (
                  <div key={t.id} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">Ticket #{t.ticket_number ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(t.paid_at).toLocaleString('fr-FR', {
                          weekday: 'short',
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {badge ? (
                      <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', badge.cls)}>
                        {badge.label}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="flex-shrink-0 text-sm font-bold text-foreground whitespace-nowrap text-right">
                      {formatCurrency(t.total_cents, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Footer summary */}
            <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-t border-border text-xs text-muted-foreground">
              <span>{rows.length} ticket{rows.length > 1 ? 's' : ''}</span>
              <span className="font-semibold text-foreground">
                {formatCurrency(rows.reduce((s, t) => s + (t.total_cents || 0), 0), currency)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
