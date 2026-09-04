import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { QuickAction } from '@/components/QuickAction';
import { TransactionItem } from '@/components/TransactionItem';
import { WalletActions } from '@/components/WalletActions';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Receipt, TrendingUp, QrCode, ArrowUpRight, ArrowDownLeft, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ClientDashboard() {
  const navigate = useNavigate();
  const [walletCurrency, setWalletCurrency] = useState<'CDF' | 'USD'>('CDF');
  const { data: stats } = useQuery({
    queryKey: ['client-stats'],
    queryFn: async () => {
      const { data } = await api.get('/users/me/stats');
      return data;
    },
  });

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      const { data } = await api.get('/wallet');
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

  const walletQueryKeys = [['wallet'], ['wallet-transactions']];
  useRealtimeInvalidate('wallet_topups', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('withdrawals', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `sender_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `recipient_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Mon compte" />

      <BalanceCard
        balances={wallet?.balances || { CDF: 0, USD: 0 }}
        label="Solde LinkPay"
        subtitle={wallet?.wallet_number}
        maskable
        onCurrencyChange={setWalletCurrency}
        actions={<WalletActions currency={walletCurrency} />}
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <DualCurrencyStat amounts={stats?.spent || { CDF: 0, USD: 0 }} />
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
