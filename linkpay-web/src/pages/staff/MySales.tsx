import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
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

/** Toutes les ventes payées de l'organisation pour la période [from, to). */
async function fetchMySales(orgId: string, from: string, to: string): Promise<any[]> {
  // L'API renvoie d'un coup toutes les ventes de la période (pas de pagination).
  const { data } = await api.get(`/organizations/${orgId}/sales/history`, { params: { from, to } });
  const items: any[] = Array.isArray(data) ? data : (data.data ?? []);
  // Le module Ventes enregistre ses statuts en majuscules ('PAID', 'CANCELLED'…).
  return items
    .filter((s: any) => String(s.status).toUpperCase() === 'PAID')
    .map((s: any) => ({ ...s, payment_method: s.payment_method === 'wallet' ? 'scanlinkpay' : s.payment_method }));
}

/**
 * "Mes ventes" — tableau professionnel des ventes du vendeur :
 * navigation mensuelle, toggle CDF/USD, 4 cartes KPI,
 * filtres par méthode de paiement, tableau individuel de chaque vente.
 */
export default function MySalesPage() {
  const [offset, setOffset] = useState(0); // 0 = ce mois, -1 = mois précédent…
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

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: sales, isLoading } = useQuery({
    queryKey: ['my-sales', org?.id, from],
    queryFn: () => fetchMySales(org!.id, from, to),
    enabled: !!org?.id,
  });

  // Si le mois n'a aucune vente dans la devise choisie mais en a dans l'autre, basculer dessus.
  useEffect(() => {
    if (!sales?.length) return;
    if (!sales.some((t) => t.currency === currency)) {
      const other = sales.find((t) => t.currency === 'CDF' || t.currency === 'USD')?.currency;
      if (other) setCurrency(other);
    }
  }, [sales]); // eslint-disable-line react-hooks/exhaustive-deps

  // Base : toutes les ventes payées dans la devise sélectionnée
  const base = (sales || []).filter((t) => t.currency === currency);

  // KPI (calculés sur tout le mois, indépendamment du filtre méthode)
  const monthTotal = base.reduce((s, t) => s + (t.total_cents || 0), 0);
  const cashTotal = base.filter((t) => t.payment_method === 'cash').reduce((s, t) => s + (t.total_cents || 0), 0);
  const slpTotal = base.filter((t) => t.payment_method === 'scanlinkpay').reduce((s, t) => s + (t.total_cents || 0), 0);
  const monthCount = base.length;
  const activeDays = new Set(base.map((t) => {
    const d = t.paid_at || t.created_at;
    return d ? dayKey(new Date(d)) : null;
  }).filter(Boolean)).size;

  // Lignes du tableau : filtrées par méthode, triées du plus récent au plus ancien
  const rows = [...base]
    .filter((t) => !method || t.payment_method === method)
    .sort((a, b) => {
      const da = a.paid_at || a.created_at || '';
      const db = b.paid_at || b.created_at || '';
      return db > da ? 1 : -1;
    });

  const saleLabel = (t: any) => {
    if (t.reference) return t.reference;
    if (t.ticket_number) return `Ticket #${t.ticket_number}`;
    return 'Vente';
  };

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-2xl mx-auto">
      <PageHeader title="Mes ventes" />

      {/* Navigation mensuelle + toggle devise */}
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
                currency === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/30'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* 4 cartes KPI */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total du mois</p>
          <p className="mt-1 text-lg font-bold text-foreground [overflow-wrap:anywhere]">
            {formatCurrency(monthTotal, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Ventes · Jours travaillés</p>
          <p className="mt-1 text-lg font-bold text-foreground">{monthCount} · {activeDays}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> Espèces
          </div>
          <p className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-400 [overflow-wrap:anywhere]">
            {formatCurrency(cashTotal, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> ScanLinkPay
          </div>
          <p className="mt-1 text-base font-bold text-primary [overflow-wrap:anywhere]">
            {formatCurrency(slpTotal, currency)}
          </p>
        </div>
      </div>

      {/* Filtres par méthode de paiement */}
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

      {/* Tableau des ventes */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {isLoading || !org?.id ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Aucune vente{method ? ` (${METHODS.find((m) => m.value === method)?.label})` : ''} en {currency} ce mois-ci.
          </p>
        ) : (
          <>
            {/* En-tête */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 bg-secondary text-xs font-medium text-muted-foreground border-b border-border">
              <span>Référence · Date</span>
              <span className="text-center">Mode</span>
              <span className="text-right">Montant</span>
            </div>
            {/* Lignes */}
            <div className="divide-y divide-border">
              {rows.map((t) => {
                const badge = METHOD_BADGE[t.payment_method as keyof typeof METHOD_BADGE];
                const dateStr = t.paid_at || t.created_at;
                return (
                  <div key={t.id} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{saleLabel(t)}</p>
                      <p className="text-xs text-muted-foreground">
                        {dateStr
                          ? new Date(dateStr).toLocaleString('fr-FR', {
                              weekday: 'short',
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
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
            {/* Pied de tableau */}
            <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-t border-border text-xs text-muted-foreground">
              <span>{rows.length} vente{rows.length > 1 ? 's' : ''}</span>
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
