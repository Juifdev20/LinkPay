import { useAuthStore } from '@/lib/auth-store';
import { UserCircle } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  magasinier: 'Magasinier',
  vendeur: 'Vendeur',
  caissier: 'Caissier',
  comptable: 'Comptable',
};

/**
 * Minimal placeholder dashboard for enterprise-internal staff accounts
 * (magasinier/vendeur/caissier/comptable — see organization-staff module).
 * No stock/caisse/ventes module exists yet for these roles to actually use
 * — this just confirms login works and shows who's signed in, ready to be
 * replaced once each business module lands.
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);

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
