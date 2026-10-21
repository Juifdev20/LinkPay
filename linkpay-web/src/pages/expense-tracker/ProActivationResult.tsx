import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { Button } from '@/components/ui/button';
import { ResultView, ResultCard } from '@/components/ResultView';
import { Crown } from 'lucide-react';

interface ExpenseProPayment {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  extended_to?: string;
}

/**
 * Lands here after the payment provider's redirect for a Pro-activation payment
 * (expense-tracker.service.ts sets redirect_url to .../pro/result?ref=...).
 * Same polling pattern as wallet/TopupResult.tsx — the webhook may still be
 * catching up when the user is redirected back.
 */
export default function ProActivationResultPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref');

  const { data, isLoading, timedOut } = usePaymentStatusPoll<ExpenseProPayment>(
    ['expense-pro-payment-status', ref],
    async () => (await api.get(`/expense-tracker/pro/payments/${encodeURIComponent(ref ?? "")}/status`)).data,
    (d) => d.status,
    !!ref,
  );

  useEffect(() => {
    if (data?.status === 'SUCCESS') {
      queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] });
      queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
    }
  }, [data?.status, queryClient]);

  if (!ref || isLoading || !data) {
    return (
      <ResultCard>
        <ResultView tone="pending" title="Vérification du paiement" message="Nous confirmons votre paiement auprès du prestataire…" />
      </ResultCard>
    );
  }

  const status = timedOut ? 'PENDING' : data.status;
  const until = data.extended_to ? new Date(data.extended_to).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined;

  return (
    <ResultCard>
      {status === 'SUCCESS' ? (
        <ResultView
          tone="success"
          icon={Crown}
          title="Mode Pro activé"
          message="Vous pouvez de nouveau ajouter vos dépenses, sans limite."
          rows={until ? [{ label: 'Valable jusqu\'au', value: until }] : []}
        >
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard/expenses')}>Aller à Mes dépenses</Button>
        </ResultView>
      ) : status === 'FAILED' ? (
        <ResultView tone="error" title="Paiement non abouti" message="Aucun montant n'a été débité. Vous pouvez réessayer.">
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard/expenses')}>Retour à Mes dépenses</Button>
        </ResultView>
      ) : (
        <ResultView tone="waiting" title="Paiement en cours" message="Le résultat sera confirmé dans quelques instants. Le mode Pro s'activera tout seul.">
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard/expenses')}>Retour à Mes dépenses</Button>
        </ResultView>
      )}
    </ResultCard>
  );
}
