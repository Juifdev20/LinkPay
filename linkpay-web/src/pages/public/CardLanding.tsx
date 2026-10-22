import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Loader2, Send } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { ResultView } from '@/components/ResultView';

const SELLER_ROLES = ['merchant', 'cashier', 'caissier', 'vendeur', 'enterprise'];

/** What opens when someone scans a ScanLinkPay card with a phone camera: /c/:token. */
export default function CardLandingPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [info, setInfo] = useState<{ holder: string; wallet_number: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    api.get(`/cards/resolve/${encodeURIComponent(token)}`)
      .then(({ data }) => setInfo(data))
      .catch((e) => setError(e?.response?.data?.message || 'Carte introuvable ou non activée.'));
  }, [isAuthenticated, token]);

  if (!isAuthenticated) {
    return (
      <PublicShell>
        <PublicCard className="py-8">
          <ResultView
            tone="info"
            icon={CreditCard}
            title="Carte ScanLinkPay"
            message="Connectez-vous à votre compte, puis scannez de nouveau la carte pour payer ou envoyer de l'argent à son titulaire."
          >
            <Button asChild className="h-[52px] w-full rounded-xl text-base font-semibold"><Link to="/login">Se connecter</Link></Button>
            <Button asChild variant="ghost" className="h-12 w-full rounded-xl"><Link to="/register">Créer un compte</Link></Button>
          </ResultView>
        </PublicCard>
      </PublicShell>
    );
  }

  // A seller scanning a customer's card wants to charge it, not to send money to it.
  const seller = !!user && (SELLER_ROLES.includes(user.role) || !!user.acting_as_org_id) && user.role !== 'client';
  if (seller && !error) return <Navigate to={`/dashboard/card/charge?t=${encodeURIComponent(token)}`} replace />;

  return (
    <PublicShell onBack={() => navigate('/dashboard')}>
      <PublicCard className="py-8">
        {!info && !error && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Lecture de la carte…</p>
          </div>
        )}
        {error && (
          <ResultView tone="error" icon={CreditCard} title="Carte non reconnue" message={error}>
            <Button variant="outline" className="h-12 w-full rounded-xl" onClick={() => navigate('/dashboard')}>Retour</Button>
          </ResultView>
        )}
        {info && (
          <ResultView
            tone="info"
            icon={CreditCard}
            title={`Carte de ${info.holder}`}
            message="Envoyez de l'argent directement à son portefeuille ScanLinkPay."
            rows={[{ label: 'Portefeuille', value: info.wallet_number, className: 'font-mono text-xs' }]}
          >
            <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate(`/dashboard/wallet/send?to=${encodeURIComponent(info.wallet_number)}`)}>
              <Send className="mr-2 h-5 w-5" /> Envoyer de l'argent
            </Button>
            <Button variant="ghost" className="h-12 w-full rounded-xl" onClick={() => navigate('/dashboard')}>Retour</Button>
          </ResultView>
        )}
      </PublicCard>
    </PublicShell>
  );
}
