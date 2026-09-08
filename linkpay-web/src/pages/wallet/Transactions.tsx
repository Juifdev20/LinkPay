import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { TransactionItem } from '@/components/TransactionItem';
import { cn } from '@/lib/utils';

const ENTRY_LABELS: Record<string, string> = {
  TOPUP: 'Recharge',
  TRANSFER_IN: 'Reçu',
  TRANSFER_OUT: 'Envoyé',
  WITHDRAWAL: 'Retrait',
  PAYMENT: 'Paiement facture',
  ADJUSTMENT: 'Ajustement',
};

const FILTERS = [
  { key: 'all', label: 'Toutes' },
  { key: 'in', label: 'Reçues' },
  { key: 'out', label: 'Envoyées' },
  { key: 'TOPUP', label: 'Recharges' },
  { key: 'PAYMENT', label: 'Paiements' },
  { key: 'WITHDRAWAL', label: 'Retraits' },
];

export default function WalletTransactionsPage() {
  const [filter, setFilter] = useState('all');

  const { data } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: async () => {
      const { data } = await api.get('/wallet/transactions?limit=100');
      return data;
    },
  });

  const entries = (data?.data || []).filter((e: any) => {
    if (filter === 'all') return true;
    if (filter === 'in') return e.direction === 'credit';
    if (filter === 'out') return e.direction === 'debit';
    return e.entry_type === filter;
  });

  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Mes transactions" />

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors',
              filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-accent',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          {entries.length ? (
            <div>
              {entries.map((e: any) => (
                <TransactionItem
                  key={e.id}
                  name={ENTRY_LABELS[e.entry_type] || e.entry_type}
                  amountCents={e.amount_cents}
                  currency={e.currency}
                  status="SUCCESS"
                  date={e.created_at}
                  type={e.direction === 'credit' ? 'in' : 'out'}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-10">Aucune transaction pour ce filtre</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
