import { useAuthStore } from '@/lib/auth-store';
import StockPage from '@/pages/organization/Stock';
import PosPage from '@/pages/pos/PosPage';
import SalesDashboardPage from '@/pages/organization/SalesDashboard';

/**
 * Landing screen for enterprise-internal staff (organization-staff module).
 * Each role gets the screen built for its job:
 *  - magasinier → Stock & Approvisionnement (full stock management)
 *  - vendeur    → sales dashboard in its light variant (volume and revenue,
 *                 no margins — the API strips those for this role)
 *  - caissier   → the till (POS module — caisse is their direct job)
 *  - comptable  → sales dashboard (full financial view, margins and fees)
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'magasinier') {
    return <StockPage />;
  }
  if (user?.role === 'caissier') {
    return <PosPage />;
  }

  return <SalesDashboardPage variant={user?.role === 'vendeur' ? 'light' : 'full'} />;
}
