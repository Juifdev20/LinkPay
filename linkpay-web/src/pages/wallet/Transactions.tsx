import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LedgerItem, ledgerTitle } from '@/components/LedgerItem';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'all', label: 'Toutes' },
  { key: 'in', label: 'Entrées' },
  { key: 'out', label: 'Sorties' },
] as const;

const KIND_FILTERS = [
  { key: '', label: 'Tout' },
  { key: 'TOPUP', label: 'Recharges' },
  { key: 'TRANSFER', label: 'Transferts' },
  { key: 'PAYMENT', label: 'Paiements' },
  { key: 'WITHDRAWAL', label: 'Retraits' },
];

/** The wallet's history (the "Transactions" tab), as in the design: search, Toutes / Entrées / Sorties, coloured lines. */
export default function WalletTransactionsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [kind, setKind] = useState('');
  const [showKinds, setShowKinds] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: async () => (await api.get('/wallet/transactions?limit=100')).data,
  });

  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.data || []).filter((e: any) => {
      if (tab === 'in' && e.direction !== 'credit') return false;
      if (tab === 'out' && e.direction !== 'debit') return false;
      if (kind && !String(e.entry_type).startsWith(kind)) return false;
      if (q && !`${ledgerTitle(e)} ${e.counterparty || ''} ${e.reference || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, tab, kind, search]);

  return (
    <div className="px-4 pt-2 pb-8 md:p-6 space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Transactions" />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une transaction…"
            className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowKinds((v) => !v)}
          aria-label="Filtrer par type"
          className={cn('flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card transition-colors', (showKinds || kind) && 'border-primary text-primary')}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
        </button>
      </div>

      {showKinds && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKind(f.key)}
              className={cn(
                'flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
                kind === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full py-2 text-xs font-semibold transition-all',
              tab === t.key ? 'bg-brand-gradient text-white shadow-brand' : 'text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 shadow-soft divide-y divide-border">
        {isLoading ? (
          <div className="space-y-3 py-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : entries.length ? (
          entries.map((e: any) => <LedgerItem key={e.id} entry={e} />)
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucune transaction{search || kind || tab !== 'all' ? ' pour ce filtre' : ' pour le moment'}</p>
        )}
      </div>
    </div>
  );
}
