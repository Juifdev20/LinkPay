import { useLocation, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { CheckCircle, XCircle } from 'lucide-react';

export default function PaymentResultPage() {
  const location = useLocation();
  const state = location.state as { status?: string; reference?: string; message?: string };

  const success = state?.status === 'success';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <Card className="text-center">
          <CardContent className="pt-6">
            {success ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-success" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Paiement réussi !</h2>
                <p className="text-muted-foreground mb-2">
                  Référence : <span className="font-mono text-foreground">{state?.reference}</span>
                </p>
                <p className="text-muted-foreground text-sm mb-6">Vous recevrez un reçu par email.</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Paiement échoué</h2>
                <p className="text-muted-foreground text-sm mb-6">{state?.message || 'Une erreur est survenue.'}</p>
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
