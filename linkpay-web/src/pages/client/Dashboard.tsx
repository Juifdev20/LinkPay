import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { RecentLedger } from '@/components/RecentLedger';
import { WalletActions } from '@/components/WalletActions';
import { StatTile } from '@/components/StatTile';
import { ShortcutButton } from '@/components/ShortcutButton';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Receipt, TrendingUp, RefreshCcw, PiggyBank, Wallet2 } from 'lucide-react';
import { FEATURES } from '@/lib/features';
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

  const walletQueryKeys = [['wallet'], ['wallet-transactions']];
  useRealtimeInvalidate('wallet_topups', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('withdrawals', wallet ? `wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `sender_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `recipient_wallet_id=eq.${wallet.id}` : undefined, walletQueryKeys, !!wallet);

  return (
    <div className="px-4 pt-2 pb-8 md:p-6 space-y-5 max-w-6xl mx-auto">
      <PageHeader title="Tableau de bord" hideBack />

      {/* Computer: balance, figures and shortcuts on the left, the latest movements beside them — the phone keeps
          its single column. */}
      <div className="space-y-5 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-5 lg:col-span-3">
          <BalanceCard
            balances={wallet?.balances || { CDF: 0, USD: 0 }}
            label="Solde ScanLinkPay"
            subtitle={wallet?.wallet_number}
            maskable
            onCurrencyChange={setWalletCurrency}
            actions={<WalletActions currency={walletCurrency} />}
          />

          <div className="grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
            {FEATURES.tontines && <ShortcutButton icon={RefreshCcw} label="Tontines" onClick={() => navigate('/dashboard/tontines')} />}
            {FEATURES.savings && <ShortcutButton icon={PiggyBank} label="Épargne" onClick={() => navigate('/dashboard/savings')} />}
            <ShortcutButton icon={Wallet2} label="Mes dépenses" onClick={() => navigate('/dashboard/expenses')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={TrendingUp} label="Total dépensé" money={stats?.spent || { CDF: 0, USD: 0 }} />
            <StatTile icon={Receipt} label="Paiements effectués" value={String(stats?.total_payments || 0)} />
          </div>
        </div>
        <div className="lg:col-span-2">
          <RecentLedger />
        </div>
      </div>
    </div>
  );
}
