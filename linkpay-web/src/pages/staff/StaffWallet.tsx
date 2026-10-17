import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { Card, CardContent } from '@/components/ui/card';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { ArrowUpFromLine, QrCode, History, ChevronRight } from 'lucide-react';

/**
 * An employee's own ScanLinkPay wallet — where the patron sends their salary
 * and from where they withdraw it to Mobile Money. It is NOT the business's
 * money: the takings sit in the patron's wallet and no employee can reach them.
 */
export default function StaffWalletPage() {
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  const keys = [['wallet'], ['wallet-transactions']];
  useRealtimeInvalidate('withdrawals', wallet ? `wallet_id=eq.${wallet.id}` : undefined, keys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `recipient_wallet_id=eq.${wallet.id}` : undefined, keys, !!wallet);

  const withdrawPath = `/dashboard/wallet/withdraw?currency=${currency}`;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Mon portefeuille" hideBack />

      <BalanceCard
        balances={wallet?.balances || { CDF: 0, USD: 0 }}
        label="Mon solde ScanLinkPay"
        subtitle={wallet?.wallet_number}
        maskable
        onCurrencyChange={setCurrency}
      />

      <Link
        to={withdrawPath}
        className="flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-4 text-base font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
      >
        <ArrowUpFromLine className="w-5 h-5" />
        Retirer mon salaire
      </Link>

      <Card>
        <CardContent className="p-0">
          <Link to="/dashboard/wallet/receive" className="flex items-center gap-3 px-5 py-4 border-b border-border hover:bg-accent/50 transition-colors">
            <QrCode className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">Mon numéro ScanLinkPay</p>
              <p className="text-xs text-muted-foreground">À donner au patron pour recevoir votre salaire{wallet?.wallet_number ? ` : ${wallet.wallet_number}` : ''}.</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>
          <Link to="/dashboard/wallet/transactions" className="flex items-center gap-3 px-5 py-4 hover:bg-accent/50 transition-colors">
            <History className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">Historique</p>
              <p className="text-xs text-muted-foreground">Salaires reçus et retraits effectués.</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Le retrait demande votre code PIN de transaction. Si vous n'en avez pas encore, l'application vous aide à le créer.
      </p>
    </div>
  );
}
