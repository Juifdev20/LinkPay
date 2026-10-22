import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { TopupStatusCard, TopupCardStatus } from '@/components/TopupStatusCard';
import { ResultView, ResultCard } from '@/components/ResultView';
import { Button } from '@/components/ui/button';

interface FundedTransfer {
  id: string;
  amount_cents: number;
  currency: 'CDF' | 'USD';
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

interface TransferStatusResponse {
  transfer: FundedTransfer;
}

/**
 * Lands here when the sender comes back from the provider's checkout page
 * (card) after funding a person-to-person send — wallets.service.ts sets
 * redirect_url to .../dashboard/wallet/send/result?ref=<reference>. No
 * in-memory result exists here: ask the backend and poll while the webhook
 * may still be catching up, exactly like TopupResult does for a top-up.
 */
export default function SendResultPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref');

  const { data, isLoading, timedOut } = usePaymentStatusPoll<TransferStatusResponse>(
    ['transfer-status', ref],
    async () => (await api.get(`/wallet/transfers/${encodeURIComponent(ref ?? "")}/status`)).data,
    (d) => d.transfer.status,
    !!ref,
  );

  useEffect(() => {
    if (data?.transfer.status === 'SUCCESS') {
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    }
  }, [data?.transfer.status, queryClient]);

  if (!ref) {
    return (
      <ResultCard>
        <ResultView tone="error" title="Opération introuvable" message="Référence d'envoi manquante. Retrouvez l'opération dans vos transactions.">
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

  const status: TopupCardStatus = timedOut ? 'TIMEDOUT' : data.transfer.status;

  return (
    <TopupStatusCard
      kind="transfer"
      status={status}
      amountCents={data.transfer.amount_cents}
      currency={data.transfer.currency}
      reference={ref}
      onBack={() => navigate('/dashboard')}
    />
  );
}
