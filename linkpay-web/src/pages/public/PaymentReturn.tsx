import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { ResultView } from '@/components/ResultView';

/** Where each kind of payment shows its outcome. Only these — the address in the link is never followed as given. */
const RESULT_PAGES: Record<string, string> = {
  topup: '/dashboard/wallet/topup/result',
  invoice: '/payment/result',
  expense: '/dashboard/expenses/pro/result',
};

/**
 * Where the payment provider's page (bank card) sends the person back, whatever the outcome (paid, cancelled, declined).
 * The address says nothing about the result: the result page asks the API.
 *  - Signed in on this browser (the web app): straight to the result page.
 *  - Not signed in (the Android app opened the provider's page in the phone's browser, which has no session): a
 *    neutral message — never "paid" nor "failed", because this page does not know — telling to go back to the app,
 *    where the balance updates by itself as soon as the payment is confirmed.
 */
export default function PaymentReturnPage() {
  const [params] = useSearchParams();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const base = RESULT_PAGES[params.get('to') ?? ''];
  const ref = params.get('ref') ?? '';
  const target = base && /^[A-Za-z0-9-]{6,64}$/.test(ref) ? `${base}?ref=${encodeURIComponent(ref)}` : null;

  if (isAuthenticated && target) return <Navigate to={target} replace />;

  return (
    <PublicShell>
      <PublicCard className="py-8">
        <ResultView
          tone="info"
          title="Retour de la page de paiement"
          message={
            <>
              Si vous venez de payer, retournez dans l'application ScanLinkPay : votre solde se met à jour dès que la banque
              confirme le paiement (quelques instants).
              <span className="mt-2 block font-medium text-foreground">Rien n'est débité sans votre confirmation sur la page de la banque.</span>
            </>
          }
        >
          {target && (
            <Button asChild className="h-[52px] w-full rounded-xl text-base font-semibold">
              <Link to={`/login?redirect=${encodeURIComponent(target)}`}>Suivre le paiement dans mon compte</Link>
            </Button>
          )}
        </ResultView>
      </PublicCard>
    </PublicShell>
  );
}
