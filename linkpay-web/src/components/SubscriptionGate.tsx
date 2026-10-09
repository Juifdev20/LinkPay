import { Link } from 'react-router-dom';
import { Loader2, Lock, Sparkles, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { isUsable, isWritable, useSubscription } from '@/lib/subscription';

/**
 * Wraps a business screen. During the free trial or with a running subscription
 * it just shows the screen. Otherwise, depending on what the super admin chose:
 *  - read-only: the screen opens with a banner (the API refuses changes);
 *  - blocked: an "abonnement requis" page that leads to the payment.
 * It never blocks when the status can't be read — the API is the real gate.
 */
export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { data: state, isLoading, isOwner, applies } = useSubscription();
  if (!applies) return <>{children}</>;
  if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (isWritable(state)) return <>{children}</>;

  const expired = state?.status === 'expired';
  if (isUsable(state)) {
    return (
      <>
        <div role="status" className="mx-4 mt-4 md:mx-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
          <Eye className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Lecture seule</p>
            <p>{expired ? 'Votre abonnement a expiré.' : "Vous n'avez pas d'abonnement actif."} Vous pouvez consulter, pas modifier.</p>
            {isOwner && <Link to="/dashboard/organization/subscription" className="font-semibold underline">Ajouter des mois</Link>}
          </div>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center"><Lock className="w-6 h-6 text-primary" /></div>
          <h2 className="text-lg font-bold">Abonnement requis</h2>
          <p className="text-sm text-muted-foreground">
            {expired ? 'Votre abonnement a expiré.' : "Vous n'avez pas d'abonnement actif pour utiliser cette fonctionnalité."}
          </p>
          {isOwner ? (
            <Button asChild className="w-full">
              <Link to="/dashboard/organization/subscription"><Sparkles className="w-4 h-4 mr-2" /> S'abonner</Link>
            </Button>
          ) : (
            <p className="text-sm font-medium">Demandez au patron de renouveler l'abonnement : votre accès reprendra dès le paiement.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
