import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';

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
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <CreditCard className="w-10 h-10 text-primary mx-auto" />
          <h1 className="text-xl font-bold">Carte ScanLinkPay</h1>
          <p className="text-sm text-muted-foreground">Connectez-vous à votre compte ScanLinkPay, puis scannez de nouveau la carte pour payer ou envoyer de l'argent à son titulaire.</p>
          <Button asChild className="w-full"><Link to="/login">Se connecter</Link></Button>
        </div>
      </div>
    );
  }

  // A seller scanning a customer's card wants to charge it, not to send money to it.
  const seller = !!user && (SELLER_ROLES.includes(user.role) || !!user.acting_as_org_id) && user.role !== 'client';
  if (seller && !error) return <Navigate to={`/dashboard/card/charge?t=${encodeURIComponent(token)}`} replace />;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <CreditCard className="w-10 h-10 text-primary mx-auto" />
        {!info && !error && <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />}
        {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        {info && (
          <>
            <h1 className="text-xl font-bold">Carte de {info.holder}</h1>
            <p className="text-sm text-muted-foreground">Envoyez de l'argent à son portefeuille ScanLinkPay.</p>
            <Button className="w-full" onClick={() => navigate(`/dashboard/wallet/send?to=${encodeURIComponent(info.wallet_number)}`)}>Envoyer de l'argent</Button>
          </>
        )}
        <Button variant="ghost" className="w-full" onClick={() => navigate('/dashboard')}>Retour</Button>
      </div>
    </div>
  );
}
