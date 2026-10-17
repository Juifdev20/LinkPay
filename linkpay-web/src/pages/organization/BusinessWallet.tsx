import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { BalanceCard } from '@/components/BalanceCard';
import { Card, CardContent } from '@/components/ui/card';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { ArrowDownToLine, ArrowUpFromLine, History, ChevronRight, Sparkles } from 'lucide-react';

/**
 * The owner's ScanLinkPay wallet, seen as the business's: every ScanLinkPay
 * payment taken by any station (QR, card, online) lands here, net of fees,
 * and the subscription is paid from it. Cash sales stay in the tills' drawers
 * and never pass through it.
 */
export default function BusinessWalletPage() {
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  const keys = [['wallet'], ['wallet-transactions']];
  useRealtimeInvalidate('withdrawals', wallet ? `wallet_id=eq.${wallet.id}` : undefined, keys, !!wallet);
  useRealtimeInvalidate('transfers', wallet ? `recipient_wallet_id=eq.${wallet.id}` : undefined, keys, !!wallet);
  useRealtimeInvalidate('transactions', undefined, keys, !!wallet);

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Portefeuille de l'entreprise" />

      <BalanceCard
        balances={wallet?.balances || { CDF: 0, USD: 0 }}
        label="Solde ScanLinkPay"
        subtitle={wallet?.wallet_number}
        maskable
        onCurrencyChange={setCurrency}
      />

      <div className="grid grid-cols-2 gap-3">
        <Link
          to={`/dashboard/wallet/topup?currency=${currency}&retour=/dashboard/organization/wallet`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-4 text-sm font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors"
        >
          <ArrowDownToLine className="w-5 h-5" /> Recharger
        </Link>
        <Link
          to={`/dashboard/wallet/withdraw?currency=${currency}`}
          className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-4 text-sm font-semibold text-foreground hover:bg-accent/50 transition-colors"
        >
          <ArrowUpFromLine className="w-5 h-5" /> Retirer
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <Link to="/dashboard/wallet/transactions" className="flex items-center gap-3 px-5 py-4 border-b border-border hover:bg-accent/50 transition-colors">
            <History className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">Historique</p>
              <p className="text-xs text-muted-foreground">Paiements reçus, recharges, retraits et abonnement.</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>
          <Link to="/dashboard/organization/subscription" className="flex items-center gap-3 px-5 py-4 hover:bg-accent/50 transition-colors">
            <Sparkles className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">Abonnement</p>
              <p className="text-xs text-muted-foreground">Payé depuis ce portefeuille.</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Les paiements ScanLinkPay reçus par toutes vos stations (QR, carte, en ligne) arrivent ici, frais déduits.
        Les ventes en espèces restent dans les caisses.
      </p>
    </div>
  );
}
