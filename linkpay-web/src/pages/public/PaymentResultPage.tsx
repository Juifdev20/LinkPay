import { useEffect } from 'react';
import { useLocation, useSearchParams, Link } from 'react-router-dom';
import api from '@/lib/api';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { Button } from '@/components/ui/button';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { ResultView, type ResultRow } from '@/components/ResultView';
import { useAuthStore } from '@/lib/auth-store';
import { formatCurrency } from '@/lib/utils';
import { announce, announcePaymentError } from '@/lib/sound';

interface PaymentStatusResponse {
  reference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  amount_cents: number;
  currency: string;
}

export default function PaymentResultPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Fast path: the synchronous in-app payment flow (PaymentLinkPage.tsx)
  // navigates here with router state already carrying the outcome — no
  // network round trip needed.
  const state = location.state as { status?: string; reference?: string; message?: string } | null;

  // Real path: the provider's payment page redirects the browser back here as a full
  // page navigation, which never carries router state — only the `?ref=`
  // query param survives. Poll the status endpoint using it, since the
  // redirect URL alone can't distinguish success from failure.
  const ref = searchParams.get('ref');

  const { data, isLoading, timedOut } = usePaymentStatusPoll<PaymentStatusResponse>(
    ['payment-status', ref],
    async () => (await api.get(`/payments/status/${encodeURIComponent(ref ?? "")}`)).data,
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

  // Voice, once per outcome: "Paiement réussi", or "Solde insuffisant" / "Paiement échoué" according to the reason given.
  useEffect(() => {
    if (view === 'success') announce.paymentSuccess();
    else if (view === 'failed') announcePaymentError(message);
  }, [view, message]);

  const amount = data?.amount_cents ? formatCurrency(data.amount_cents, data.currency) : undefined;
  const rows: ResultRow[] = reference ? [{ label: 'Référence', value: reference, copy: reference }] : [];

  return (
    <PublicShell>
      <PublicCard className="py-8">
        {view === 'success' && (
          <ResultView
            tone="success"
            title="Paiement réussi"
            amount={amount}
            message="Merci ! Le commerçant a reçu votre paiement. Gardez la référence ci-dessous comme preuve."
            rows={[...rows, { label: 'Statut', value: 'Confirmé', className: 'text-success' }]}
          >
            <HomeButton />
          </ResultView>
        )}
        {view === 'failed' && (
          <ResultView
            tone="error"
            title="Paiement non abouti"
            amount={amount}
            message={<>{message || 'Le paiement n\'a pas pu être effectué.'} <span className="font-medium text-foreground">Aucun montant n'a été débité.</span></>}
            rows={rows}
          >
            {/* Back to the payment link page only when we came from it in this tab (not from the provider's page). */}
            {state ? (
              <>
                <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => window.history.back()}>Réessayer</Button>
                <HomeButton variant="ghost" />
              </>
            ) : (
              <HomeButton />
            )}
          </ResultView>
        )}
        {view === 'pending' && (
          <ResultView
            tone="pending"
            title="Confirmation en cours"
            amount={amount}
            message="Nous vérifions votre paiement auprès de votre opérateur. Gardez cette page ouverte, cela prend quelques secondes."
            rows={rows}
          />
        )}
        {view === 'timedout' && (
          <ResultView
            tone="waiting"
            title="Toujours en traitement"
            amount={amount}
            message="Votre paiement met plus de temps que prévu à se confirmer. Il peut encore aboutir : vous serez prévenu dès qu'il est confirmé."
            rows={rows}
          >
            <HomeButton />
          </ResultView>
        )}
      </PublicCard>
    </PublicShell>
  );
}

function HomeButton({ variant }: { variant?: 'ghost' }) {
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  return (
    <Button asChild variant={variant} className="h-[52px] w-full rounded-xl text-base font-semibold">
      <Link to={signedIn ? '/dashboard' : '/'}>{signedIn ? 'Retour à mon compte' : 'Retour à l\'accueil'}</Link>
    </Button>
  );
}
