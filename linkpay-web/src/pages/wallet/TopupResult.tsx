import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { TopupStatusCard, TopupCardStatus } from '@/components/TopupStatusCard';
import { ResultView, ResultCard } from '@/components/ResultView';
import { Button } from '@/components/ui/button';

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
 * Lands here after a real top-up redirect from the payment provider (wallets.service.ts sets
 * redirect_url to .../dashboard/wallet/topup/result?ref=<reference>). Unlike
 * Topup.tsx's own inline pending/success steps (only reached by the
 * synchronous path), this page has no in-memory result to show
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
    async () => (await api.get(`/wallet/topups/${encodeURIComponent(ref ?? "")}/status`)).data,
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
      <ResultCard>
        <ResultView tone="error" title="Opération introuvable" message="Référence de recharge manquante. Retrouvez l'opération dans vos transactions.">
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard/wallet/transactions')}>Mes transactions</Button>
        </ResultView>
      </ResultCard>
    );
  }

  if (isLoading || !data) {
    return (
      <ResultCard>
        <ResultView tone="pending" title="Vérification en cours" message="Nous confirmons l'opération auprès du prestataire de paiement…" />
      </ResultCard>
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
