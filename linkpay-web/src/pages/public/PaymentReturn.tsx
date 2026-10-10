import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo size="lg" /></div>
        <Card className="text-center">
          <CardContent className="pt-8 pb-7">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <h1 className="mb-2 text-xl font-bold text-foreground">Retour de la page de paiement</h1>
            <p className="mb-1 text-sm text-muted-foreground">
              Si vous venez de payer, retournez dans l'application ScanLinkPay : votre solde sera mis à jour dès que la banque confirme le paiement (quelques instants).
            </p>
            <p className="mb-6 text-sm text-muted-foreground">Rien n'est débité sans votre confirmation sur la page de la banque.</p>
            {target && (
              <Button asChild size="lg" className="w-full">
                <Link to={`/login?redirect=${encodeURIComponent(target)}`}>Suivre le paiement dans mon compte</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
