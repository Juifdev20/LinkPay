import { useAuthStore } from '@/lib/auth-store';
import StockPage from '@/pages/organization/Stock';
import PosPage from '@/pages/pos/PosPage';
import SalesDashboardPage from '@/pages/organization/SalesDashboard';

/**
 * Landing screen for enterprise-internal staff (organization-staff module).
 * Each role gets the screen built for its job:
 *  - magasinier → Stock & Approvisionnement (full stock management)
 *  - vendeur    → full sales dashboard (margins included — the vendeur also
 *                 handles the till for the Ventes/electronics flow)
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

  // Seller (and legacy cashier accounts) get the full dashboard, margins included.
  return <SalesDashboardPage />;
}
