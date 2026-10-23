import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FormSheet } from '@/components/FormSheet';
import { PaymentRequestShareCard } from '@/components/PaymentRequestShareCard';
import { ResultView } from '@/components/ResultView';
import { FilterChips } from '@/components/ui/filter-chips';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { Plus, CheckCircle2, XCircle, Clock, ChevronRight, Link2, Hourglass } from 'lucide-react';

type Filter = 'all' | 'open' | 'PAID' | 'closed';

/** How each state of a request reads, in French, with its colour. */
const STATE: Record<string, { label: string; icon: typeof Clock; tone: string }> = {
  CREATED: { label: 'En attente', icon: Hourglass, tone: 'bg-warning/10 text-warning' },
  PENDING: { label: 'En attente', icon: Hourglass, tone: 'bg-warning/10 text-warning' },
  PAID: { label: 'Payée', icon: CheckCircle2, tone: 'bg-success/10 text-success' },
  EXPIRED: { label: 'Expirée', icon: Clock, tone: 'bg-muted text-muted-foreground' },
  CANCELLED: { label: 'Annulée', icon: XCircle, tone: 'bg-destructive/10 text-destructive' },
};
const stateOf = (s: string) => STATE[s] ?? STATE.PENDING;
const isOpen = (s: string) => s === 'CREATED' || s === 'PENDING';

export default function PaymentRequestsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-requests'],
    queryFn: async () => {
      const { data } = await api.get('/payment-requests');
      return data;
    },
  });
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const all: any[] = data?.data ?? [];
  const counts = useMemo(() => ({
    open: all.filter((r) => isOpen(r.status)).length,
    paid: all.filter((r) => r.status === 'PAID').length,
    closed: all.filter((r) => r.status === 'EXPIRED' || r.status === 'CANCELLED').length,
  }), [all]);
  const shown = all.filter((r) =>
    filter === 'all' ? true : filter === 'open' ? isOpen(r.status) : filter === 'PAID' ? r.status === 'PAID' : !isOpen(r.status) && r.status !== 'PAID');

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-28 md:p-6 md:pb-6">
      <PageHeader title="Demandes de paiement" action={{ label: 'Nouvelle demande', icon: Plus, to: '/dashboard/payment-requests/new' }} />

      <FilterChips<Filter>
        label="Statut"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Toutes', count: all.length },
          { value: 'open', label: 'En attente', count: counts.open },
          { value: 'PAID', label: 'Payées', count: counts.paid },
          { value: 'closed', label: 'Expirées / annulées', count: counts.closed },
        ]}
      />

      <section className="rounded-3xl border border-border bg-card px-2 py-2 shadow-soft">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        ) : shown.length ? (
          shown.map((req) => {
            const st = stateOf(req.status);
            const Icon = st.icon;
            return (
              <button
                key={req.id}
                type="button"
                onClick={() => setSelected(req)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-accent/60"
              >
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', isOpen(req.status) ? 'bg-primary/10 text-primary' : st.tone)}>
                  {isOpen(req.status) ? <Link2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{req.description || 'Demande de paiement'}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatDate(req.created_at)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(req.amount_cents, req.currency)}</span>
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', st.tone)}>
                    <Icon className="h-3 w-3" /> {st.label}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })
        ) : (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Link2 className="h-7 w-7" /></span>
            <p className="mt-3 font-semibold text-foreground">{all.length ? 'Aucune demande ici' : 'Aucune demande pour l\'instant'}</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Créez un lien ou un QR code de paiement et envoyez-le à votre client : il paie en quelques secondes.</p>
            {!all.length && (
              <Button asChild className="mt-5 h-12 rounded-xl px-6">
                <Link to="/dashboard/payment-requests/new"><Plus className="mr-2 h-4 w-4" /> Créer une demande</Link>
              </Button>
            )}
          </div>
        )}
      </section>

      {selected && (
        <FormSheet onClose={() => setSelected(null)} title="Demande de paiement">
          <div className="mx-auto max-w-md px-5 pb-6 pt-2 text-center">
            {isOpen(selected.status) ? (
              <>
                <p className="text-sm font-medium text-muted-foreground">{selected.description || 'Demande de paiement'}</p>
                <p className="mb-5 mt-1 text-[2rem] font-extrabold tracking-tight tabular-nums text-foreground">{formatCurrency(selected.amount_cents, selected.currency)}</p>
                <PaymentRequestShareCard request={selected} />
              </>
            ) : (
              <ResultView
                tone={selected.status === 'PAID' ? 'success' : selected.status === 'CANCELLED' ? 'error' : 'waiting'}
                title={selected.status === 'PAID' ? 'Payée' : selected.status === 'CANCELLED' ? 'Demande annulée' : 'Lien expiré'}
                amount={formatCurrency(selected.amount_cents, selected.currency)}
                message={selected.description || undefined}
                rows={[
                  { label: 'Référence', value: selected.reference, copy: selected.reference },
                  ...(selected.status === 'PAID' && selected.updated_at ? [{ label: 'Payée le', value: formatDate(selected.updated_at) }] : []),
                ]}
              />
            )}
          </div>
        </FormSheet>
      )}
    </div>
  );
}
