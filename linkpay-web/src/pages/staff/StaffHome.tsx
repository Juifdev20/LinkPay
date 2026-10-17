import { useAuthStore } from '@/lib/auth-store';
import StockPage from '@/pages/organization/Stock';
import CashierHome from '@/pages/staff/CashierHome';
import SalesDashboardPage from '@/pages/organization/SalesDashboard';
import OrganizationProfilePage from '@/pages/OrganizationProfile';

/**
 * Landing screen for enterprise-internal staff (organization-staff module).
 * Each role gets the screen built for its job:
 *  - magasinier → Stock & Approvisionnement (full stock management)
 *  - vendeur    → sales dashboard in its light variant (volume and revenue,
 *                 no margins — the API strips those for this role)
 *  - caissier   → their own dashboard: today's and this week's sales, their
 *                 till, their latest tickets (selling is the "Vente" tab)
 *  - comptable  → sales dashboard (full financial view, margins and fees)
 *  - gerant     → the home dashboard of their station (the API narrows
 *                 every figure to it)
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'gerant') {
    return <OrganizationProfilePage />;
  }
  if (user?.role === 'magasinier') {
    return <StockPage />;
  }
  if (user?.role === 'caissier') {
    return <CashierHome />;
  }

  // Seller (and legacy cashier accounts) get the full dashboard, margins included.
  return <SalesDashboardPage />;
}
