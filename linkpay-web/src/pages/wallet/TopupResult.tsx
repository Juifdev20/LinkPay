import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { TopupStatusCard, TopupCardStatus } from '@/components/TopupStatusCard';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface WalletTopup {
  id: string;
  amount_cents: number;
  currency: 'CDF' | 'USD';
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

interface TopupStatusResponse {
  topup: WalletTopup;
  balances: { CDF: number; USD: number };
}

/**
 * Lands here after a real CinetPay top-up redirect (wallets.service.ts sets
 * redirect_url to .../dashboard/wallet/topup/result?ref=<reference>). Unlike
 * Topup.tsx's own inline pending/success steps (only reached by the
 * synchronous mock-provider path), this page has no in-memory result to show
 * — it must ask the backend, and poll while the webhook may still be
 * catching up.
 */
export default function TopupResultPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref');

  const { data, isLoading, timedOut } = usePaymentStatusPoll<TopupStatusResponse>(
    ['topup-status', ref],
    async () => (await api.get(`/wallet/topups/${ref}/status`)).data,
    (d) => d.topup.status,
    !!ref,
  );

  useEffect(() => {
    if (data?.topup.status === 'SUCCESS') {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    }
  }, [data?.topup.status, queryClient]);

  if (!ref) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-10">
            <p className="text-muted-foreground">Référence de recharge manquante.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-semibold">Vérification du statut...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status: TopupCardStatus = timedOut ? 'TIMEDOUT' : data.topup.status;

  return (
    <TopupStatusCard
      status={status}
      amountCents={data.topup.amount_cents}
      currency={data.topup.currency}
      reference={data.topup.id}
      onBack={() => navigate('/dashboard')}
    />
  );
}
