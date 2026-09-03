import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { QuickAction } from '@/components/QuickAction';
import { TransactionItem } from '@/components/TransactionItem';
import { formatCurrency } from '@/lib/utils';
import { Receipt, TrendingUp, QrCode, ArrowUpRight, ArrowDownLeft, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ClientDashboard() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({
    queryKey: ['client-stats'],
    queryFn: async () => {
      const { data } = await api.get('/users/me/stats');
      return data;
    },
  });

  const { data: recentTx } = useQuery({
    queryKey: ['client-transactions'],
    queryFn: async () => {
      const { data } = await api.get('/transactions?limit=5');
      return data;
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Mon compte" />

      <BalanceCard
        balanceCents={stats?.total_spent_cents || 0}
        label="Total dépensé"
        actions={
          <button className="flex-1 bg-white/20 hover:bg-white/30 rounded-xl py-2.5 px-4 text-sm font-semibold transition-colors">
            Voir l'historique
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(stats?.total_spent_cents || 0)}</p>
            <p className="text-sm text-muted-foreground">Total dépensé</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Receipt className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{String(stats?.total_payments || 0)}</p>
            <p className="text-sm text-muted-foreground">Paiements effectués</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-around py-2">
        <QuickAction icon={QrCode} label="Scanner QR" onClick={() => navigate('/dashboard/payment-requests/new')} />
        <QuickAction icon={ArrowUpRight} label="Payer" onClick={() => navigate('/dashboard/payment-requests/new')} />
        <QuickAction icon={ArrowDownLeft} label="Recevoir" />
        <QuickAction icon={History} label="Historique" onClick={() => navigate('/dashboard/client/transactions')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Paiements récents</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTx?.data?.length ? (
            <div>
              {recentTx.data.map((tx: any) => (
                <TransactionItem
                  key={tx.id}
                  name={tx.merchant?.name || tx.reference}
                  amountCents={tx.amount_cents}
                  currency={tx.currency}
                  status={tx.status}
                  date={tx.created_at}
                  type="out"
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun paiement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
