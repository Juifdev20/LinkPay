import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { WalletActions } from '@/components/WalletActions';
import { TransactionItem } from '@/components/TransactionItem';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { Plus, TrendingUp, Receipt, Wallet, QrCode } from 'lucide-react';

export default function MerchantDashboard() {
  const merchantId = useAuthStore((s) => s.user?.merchant_id);
  const [walletCurrency, setWalletCurrency] = useState<'CDF' | 'USD'>('CDF');

  const { data: stats } = useQuery({
    queryKey: ['merchant-stats'],
    queryFn: async () => {
      const { data } = await api.get('/merchants/me/stats');
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
    queryKey: ['recent-transactions'],
    queryFn: async () => {
      const { data } = await api.get('/transactions?limit=5');
      return data;
    },
  });

  useRealtimeInvalidate(
    'transactions',
    merchantId ? `merchant_id=eq.${merchantId}` : undefined,
    [['merchant-stats'], ['recent-transactions']],
    !!merchantId,
  );

  const walletQueryKeys = [['wallet'], ['wallet-transactions']];
  useRealtimeInvalidate('wallet_topups', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('withdrawals', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `sender_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `recipient_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);

  const cards = [
    { label: 'Volume total', money: stats?.volume, icon: TrendingUp },
    { label: 'Transactions', value: String(stats?.total_transactions || 0), icon: Receipt },
    { label: "Aujourd'hui", value: String(stats?.today_transactions || 0), icon: QrCode },
    { label: 'En attente', money: stats?.pending, icon: Wallet },
  ];

  // Extra bottom padding on mobile clears PageHeader's floating action button
  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Tableau de bord"
        action={{ label: 'Nouvelle demande', icon: Plus, to: '/dashboard/payment-requests/new' }}
      />

      <BalanceCard
        balances={wallet?.balances || { CDF: 0, USD: 0 }}
        label="Solde LinkPay"
        subtitle={wallet?.wallet_number}
        maskable
        onCurrencyChange={setWalletCurrency}
        actions={<WalletActions currency={walletCurrency} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              {c.money ? (
                <DualCurrencyStat amounts={c.money} />
              ) : (
                <p className="text-xl font-bold text-foreground">{c.value}</p>
              )}
              <p className="text-sm text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Transactions récentes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTx?.data?.length ? (
            <div>
              {recentTx.data.map((tx: any) => (
                <TransactionItem
                  key={tx.id}
                  name={tx.reference}
                  amountCents={tx.amount_cents}
                  currency={tx.currency}
                  status={tx.status}
                  date={tx.created_at}
                  type="in"
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune transaction pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
