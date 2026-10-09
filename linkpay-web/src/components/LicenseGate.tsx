import { Link } from 'react-router-dom';
import { Loader2, Lock, KeyRound, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { featureOf, isUsable, isWritable, useLicense, type LicenseFeatureKey } from '@/lib/license';

/**
 * Wraps a screen that needs a licence. During the trial or with a running licence it
 * just shows the screen. Otherwise, depending on what the super admin chose:
 *  - read-only: the screen opens with a banner (the API refuses changes);
 *  - blocked: a "no licence" page that suggests buying one.
 * It never blocks when the status can't be read — the API is the real gate.
 */
export function LicenseGate({ feature, children }: { feature: LicenseFeatureKey; children: React.ReactNode }) {
  const { data: state, isLoading, isOwner, applies } = useLicense();
  if (!applies) return <>{children}</>;
  if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const f = featureOf(state, feature);
  if (isWritable(f)) return <>{children}</>;

  const name = f?.name || 'cette fonctionnalité';
  if (isUsable(f)) {
    return (
      <>
        <div role="status" className="mx-4 mt-4 md:mx-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
          <Eye className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Lecture seule — {name}</p>
            <p>{f?.status === 'expired' ? 'Votre licence a expiré.' : "Vous n'avez pas de licence pour cette fonctionnalité."} Vous pouvez consulter, pas modifier.</p>
            {isOwner && <Link to={`/dashboard/organization/license?feature=${feature}`} className="font-semibold underline">Ajouter des jours</Link>}
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
          <h2 className="text-lg font-bold">Licence requise</h2>
          <p className="text-sm text-muted-foreground">
            {f?.status === 'expired'
              ? `Votre licence « ${name} » a expiré.`
              : `Vous n'avez pas de licence pour la fonctionnalité « ${name} ».`}
          </p>
          {isOwner ? (
            <Button asChild className="w-full">
              <Link to={`/dashboard/organization/license?feature=${feature}`}><KeyRound className="w-4 h-4 mr-2" /> Acheter une licence</Link>
            </Button>
          ) : (
            <p className="text-sm font-medium">Demandez au patron de l'acheter : votre accès reprendra dès le paiement.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
