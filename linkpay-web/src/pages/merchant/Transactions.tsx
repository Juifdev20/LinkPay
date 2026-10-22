import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { TransactionItem } from '@/components/TransactionItem';
import { formatCurrency } from '@/lib/utils';
import { Search, ChevronLeft, ChevronRight, Loader2, Undo2, Inbox } from 'lucide-react';
import { FilterChips } from '@/components/ui/filter-chips';

const STATUSES = [
  { value: '', label: 'Tous' },
  { value: 'SUCCESS', label: 'Réussis' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'FAILED', label: 'Échoués' },
  { value: 'REFUNDED', label: 'Remboursés' },
  { value: 'PARTIALLY_REFUNDED', label: 'Remb. en partie' },
];

export default function MerchantTransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [refundTarget, setRefundTarget] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const queryClient = useQueryClient();
  const merchantId = useAuthStore((s) => s.user?.merchant_id);
  const isMerchant = useAuthStore((s) => s.user?.role === 'merchant');

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
    refundMutation.reset();
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
  const refundError = (refundMutation.error as any)?.response?.data?.message;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-28 md:p-6 md:pb-6">
      <PageHeader title={isMerchant ? 'Paiements reçus' : 'Transactions'} />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher une référence…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-12 rounded-2xl border-border bg-card pl-11 text-base shadow-sm"
        />
      </div>

      <FilterChips label="Statut" options={STATUSES} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />

      <section className="rounded-3xl border border-border bg-card px-4 py-2 shadow-soft sm:px-5">
        <p className="pt-3 text-sm font-semibold text-muted-foreground">
          {data?.total || 0} paiement{(data?.total || 0) > 1 ? 's' : ''}
        </p>
        {data?.data?.length ? (
          <>
            <div>
              {data.data.map((tx: any) => (
                <TransactionItem
                  key={tx.id}
                  name={isMerchant ? 'Paiement reçu' : tx.reference}
                  subtitle={isMerchant ? tx.reference : undefined}
                  amountCents={tx.amount_cents}
                  currency={tx.currency}
                  status={tx.status}
                  date={tx.created_at}
                  type="in"
                  action={
                    // A transaction already included in a settlement has
                    // been (or is being) paid out — the API refuses it.
                    (tx.status === 'SUCCESS' || tx.status === 'PARTIALLY_REFUNDED') && !tx.settlement_id ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Rembourser"
                        aria-label="Rembourser"
                        className="h-9 w-9 rounded-full"
                        onClick={() => openRefund(tx)}
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </div>
            {(page > 1 || data.data.length >= 20) && (
              <div className="flex items-center justify-between border-t border-border py-3">
                <Button variant="outline" size="sm" className="h-9 rounded-full" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Précédent
                </Button>
                <span className="text-sm text-muted-foreground">Page {page}</span>
                <Button variant="outline" size="sm" className="h-9 rounded-full" disabled={data.data.length < 20} onClick={() => setPage(page + 1)}>
                  Suivant <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Inbox className="h-7 w-7" /></span>
            <p className="mt-3 font-semibold text-foreground">{search || status ? 'Aucun résultat' : 'Aucun paiement pour l\'instant'}</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {search || status ? 'Essayez une autre référence ou un autre filtre.' : 'Les paiements de vos clients apparaîtront ici dès qu\'ils arrivent.'}
            </p>
          </div>
        )}
      </section>

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
            {refundMutation.isError && (
              <p className="text-sm text-destructive">{refundError || 'Échec du remboursement'}</p>
            )}
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
