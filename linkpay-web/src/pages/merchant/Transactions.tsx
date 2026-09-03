import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { TransactionItem } from '@/components/TransactionItem';
import { formatCurrency } from '@/lib/utils';
import { Search, ChevronLeft, ChevronRight, Loader2, Undo2 } from 'lucide-react';

export default function MerchantTransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [refundTarget, setRefundTarget] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const queryClient = useQueryClient();
  const merchantId = useAuthStore((s) => s.user?.merchant_id);

  const { data } = useQuery({
    queryKey: ['transactions', page, search, status],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const { data } = await api.get(`/transactions?${params}`);
      return data;
    },
  });

  useRealtimeInvalidate(
    'transactions',
    merchantId ? `merchant_id=eq.${merchantId}` : undefined,
    [['transactions']],
    !!merchantId,
  );

  const openRefund = (tx: any) => {
    setRefundTarget(tx);
    setRefundAmount(String(tx.amount_cents / 100));
    setRefundReason('');
  };

  const refundMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/refunds/transaction/${refundTarget.id}`, {
        amount_cents: Math.round(parseFloat(refundAmount) * 100),
        reason: refundReason || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setRefundTarget(null);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Transactions" />

      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par référence..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-10"
          />
        </div>
        <select
          className="rounded-xl border border-input bg-background px-4 py-3 text-sm font-medium h-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary transition-colors"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">Tous</option>
          <option value="SUCCESS">Réussi</option>
          <option value="PENDING">En attente</option>
          <option value="FAILED">Échoué</option>
          <option value="REFUNDED">Remboursé</option>
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.total || 0} transaction(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <>
              <div>
                {data.data.map((tx: any) => (
                  <TransactionItem
                    key={tx.id}
                    name={tx.reference}
                    amountCents={tx.amount_cents}
                    currency={tx.currency}
                    status={tx.status}
                    date={tx.created_at}
                    type="in"
                    action={
                      tx.status === 'SUCCESS' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Rembourser"
                          aria-label="Rembourser"
                          onClick={() => openRefund(tx)}
                        >
                          <Undo2 className="w-4 h-4" />
                        </Button>
                      ) : undefined
                    }
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
            <p className="text-muted-foreground text-center py-6">Aucune transaction</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!refundTarget} onOpenChange={(open) => !open && setRefundTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rembourser {refundTarget?.reference}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="refund_amount">Montant ({refundTarget && formatCurrency(refundTarget.amount_cents, refundTarget.currency)} max)</Label>
              <Input
                id="refund_amount"
                type="number"
                step="0.01"
                min="0"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund_reason">Motif (optionnel)</Label>
              <Input
                id="refund_reason"
                placeholder="Réclamation client..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>Annuler</Button>
            <Button
              disabled={!refundAmount || parseFloat(refundAmount) <= 0 || refundMutation.isPending}
              onClick={() => refundMutation.mutate()}
            >
              {refundMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Confirmer le remboursement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
