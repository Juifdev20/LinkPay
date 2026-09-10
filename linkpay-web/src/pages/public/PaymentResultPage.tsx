import { useLocation, useSearchParams, Link } from 'react-router-dom';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { formatCurrency } from '@/lib/utils';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface PaymentStatusResponse {
  reference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  amount_cents: number;
  currency: string;
}

export default function PaymentResultPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Fast path: the mock/synchronous in-app payment flow (PaymentLinkPage.tsx)
  // navigates here with router state already carrying the outcome — no
  // network round trip needed.
  const state = location.state as { status?: string; reference?: string; message?: string } | null;

  // Real path: a CinetPay checkout redirects the browser back here as a full
  // page navigation, which never carries router state — only the `?ref=`
  // query param survives. Poll the status endpoint using it, since the
  // redirect URL alone can't distinguish success from failure.
  const ref = searchParams.get('ref');

  const { data, isLoading, timedOut } = usePaymentStatusPoll<PaymentStatusResponse>(
    ['payment-status', ref],
    async () => (await api.get(`/payments/status/${ref}`)).data,
    (d) => d.status,
    !state && !!ref,
  );

  let view: 'success' | 'failed' | 'pending' | 'timedout';
  let reference = state?.reference;
  let message = state?.message;

  if (state) {
    view = state.status === 'success' ? 'success' : 'failed';
  } else if (!ref) {
    view = 'failed';
    message = message || 'Aucune référence de paiement fournie.';
  } else if (timedOut) {
    view = 'timedout';
  } else if (!data || isLoading) {
    view = 'pending';
  } else if (data.status === 'SUCCESS') {
    view = 'success';
    reference = data.reference;
  } else if (data.status === 'FAILED') {
    view = 'failed';
  } else {
    view = 'pending';
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <Card className="text-center">
          <CardContent className="pt-6">
            {view === 'success' && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-success" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Paiement réussi !</h2>
                {reference && (
                  <p className="text-muted-foreground mb-2">
                    Référence : <span className="font-mono text-foreground">{reference}</span>
                  </p>
                )}
                <p className="text-muted-foreground text-sm mb-6">Vous recevrez un reçu par email.</p>
              </>
            )}

            {view === 'failed' && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Paiement échoué</h2>
                <p className="text-muted-foreground text-sm mb-6">{message || 'Une erreur est survenue.'}</p>
              </>
            )}

            {view === 'pending' && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-8 h-8 text-warning animate-spin" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Confirmation en cours</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Nous vérifions le statut de votre paiement auprès de votre opérateur. Merci de patienter…
                  {data?.amount_cents ? ` (${formatCurrency(data.amount_cents, data.currency)})` : ''}
                </p>
              </>
            )}

            {view === 'timedout' && (
              <>
                <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-8 h-8 text-warning" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Toujours en cours de traitement</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Votre paiement met plus de temps que prévu à se confirmer. Il pourra tout de même aboutir —
                  vous recevrez une notification dès que ce sera fait.
                </p>
              </>
            )}

            <Button asChild size="lg" className="w-full">
              <Link to="/">Retour à l'accueil</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
