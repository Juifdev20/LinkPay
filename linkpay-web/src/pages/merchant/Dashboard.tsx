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
import { StatTile } from '@/components/StatTile';
import { Plus, TrendingUp, Receipt, Wallet, QrCode, RefreshCcw, PiggyBank, Wallet2 } from 'lucide-react';
import { FEATURES } from '@/lib/features';
import { useNavigate } from 'react-router-dom';

export default function MerchantDashboard() {
  const navigate = useNavigate();
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
        hideBack
        action={{ label: 'Nouvelle demande', icon: Plus, to: '/dashboard/payment-requests/new' }}
      />

      <BalanceCard
        balances={wallet?.balances || { CDF: 0, USD: 0 }}
        label="Solde ScanLinkPay"
        subtitle={wallet?.wallet_number}
        maskable
        onCurrencyChange={setWalletCurrency}
        actions={<WalletActions currency={walletCurrency} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <StatTile key={c.label} icon={c.icon} label={c.label} money={c.money} value={c.value} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
        {FEATURES.tontines && (
          <StatTile icon={RefreshCcw} label="Tontines" subtitle="Épargne en groupe" onClick={() => navigate('/dashboard/tontines')} />
        )}
        {FEATURES.savings && (
          <StatTile icon={PiggyBank} label="Épargne" subtitle="Par arrondi" onClick={() => navigate('/dashboard/savings')} />
        )}
        <StatTile icon={Wallet2} label="Mes dépenses" subtitle="Suivi au jour le jour" onClick={() => navigate('/dashboard/expenses')} />
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
