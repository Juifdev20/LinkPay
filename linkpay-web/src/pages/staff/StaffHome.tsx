import { useAuthStore } from '@/lib/auth-store';
import StockPage from '@/pages/organization/Stock';
import { UserCircle } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  magasinier: 'Magasinier',
  vendeur: 'Vendeur',
  caissier: 'Caissier',
  comptable: 'Comptable',
};

/**
 * Landing dashboard for enterprise-internal staff accounts (magasinier/
 * vendeur/caissier/comptable — see organization-staff module). Magasinier
 * already has a real module (Stock & Approvisionnement, backend-gated via
 * StockService.resolveMerchantAccess()) so gets it directly here; the other
 * roles stay on the placeholder until their own modules (ventes, caisse)
 * land.
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'magasinier') {
    return <StockPage />;
  }

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <UserCircle className="w-8 h-8 text-primary" />
      </div>
      <h1 className="text-xl font-bold text-foreground mb-1">{user?.full_name || user?.email}</h1>
      <p className="text-muted-foreground">{user ? ROLE_LABELS[user.role] || user.role : ''}</p>
      <p className="text-sm text-muted-foreground mt-4">
        Vos fonctionnalités seront bientôt disponibles ici.
      </p>
    </div>
  );
}
