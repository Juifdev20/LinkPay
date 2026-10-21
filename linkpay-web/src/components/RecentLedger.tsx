import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { LedgerItem } from '@/components/LedgerItem';

/** The last wallet movements on a home screen, same lines as the Transactions tab. */
export function RecentLedger({ title = 'Transactions récentes' }: { title?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: async () => (await api.get('/wallet/transactions?limit=100')).data,
  });
  const entries = (data?.data || []).slice(0, 5);
  return (
    <div className="rounded-2xl border border-border bg-card px-4 pt-4 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-foreground">{title}</p>
        <Link to="/dashboard/wallet/transactions" className="text-xs font-semibold text-primary">Voir tout</Link>
      </div>
      <div className="divide-y divide-border">
        {isLoading ? (
          <div className="space-y-3 py-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>
        ) : entries.length ? (
          entries.map((e: any) => <LedgerItem key={e.id} entry={e} />)
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune transaction pour le moment</p>
        )}
      </div>
    </div>
  );
}
