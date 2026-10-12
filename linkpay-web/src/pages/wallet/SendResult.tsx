import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { TopupStatusCard, TopupCardStatus } from '@/components/TopupStatusCard';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

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
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-10">
            <p className="text-muted-foreground">Référence d'envoi manquante.</p>
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
