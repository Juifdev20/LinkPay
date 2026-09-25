import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface ExpenseProPayment {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  extended_to?: string;
}

/**
 * Lands here after a real CinetPay redirect for a Pro-activation payment
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
    async () => (await api.get(`/expense-tracker/pro/payments/${ref}/status`)).data,
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
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-semibold">Vérification du paiement...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = timedOut ? 'PENDING' : data.status;

  return (
    <div className="p-6 max-w-lg mx-auto">
      <Card>
        <CardContent className="pt-6 text-center py-10">
          {status === 'SUCCESS' ? (
            <>
              <CheckCircle2 className="w-14 h-14 text-success mx-auto mb-4" />
              <h2 className="text-lg font-bold text-foreground mb-1">Mode Pro activé</h2>
              <p className="text-sm text-muted-foreground">Vous pouvez de nouveau ajouter des dépenses.</p>
            </>
          ) : status === 'FAILED' ? (
            <>
              <XCircle className="w-14 h-14 text-destructive mx-auto mb-4" />
              <h2 className="text-lg font-bold text-foreground mb-1">Paiement échoué</h2>
              <p className="text-sm text-muted-foreground">Veuillez réessayer.</p>
            </>
          ) : (
            <>
              <Loader2 className="w-14 h-14 text-primary animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-bold text-foreground mb-1">Paiement en cours</h2>
              <p className="text-sm text-muted-foreground">Le résultat sera confirmé sous peu.</p>
            </>
          )}
          <Button className="w-full mt-6" onClick={() => navigate('/dashboard/expenses')}>
            Retour
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
