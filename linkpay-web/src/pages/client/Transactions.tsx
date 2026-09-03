import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { TransactionItem } from '@/components/TransactionItem';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ClientTransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['client-tx', page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      const { data } = await api.get(`/transactions?${params}`);
      return data;
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Mes paiements" />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-10"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.total || 0} paiement(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <>
              <div>
                {data.data.map((tx: any) => (
                  <TransactionItem
                    key={tx.id}
                    name={tx.merchant_name || tx.reference}
                    amountCents={tx.amount_cents}
                    currency={tx.currency}
                    status={tx.status}
                    date={tx.created_at}
                    type="out"
                  />
                ))}
              </div>
              <div className="flex items-center justify-between mt-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Page {page}</span>
                <Button variant="outline" size="sm" disabled={!data?.data || data.data.length < 20} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun paiement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
