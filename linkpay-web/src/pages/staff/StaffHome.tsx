import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { isSupermarket } from '@/lib/sectors';
import MagasinierDashboard from '@/pages/organization/MagasinierDashboard';
import CashierHome from '@/pages/staff/CashierHome';
import GerantHome from '@/pages/staff/GerantHome';
import SalesDashboardPage from '@/pages/organization/SalesDashboard';

/**
 * Landing screen for enterprise-internal staff (organization-staff module).
 * Each role gets the screen built for its job:
 *  - magasinier → Stock & Approvisionnement (their station only)
 *  - vendeur    → sales dashboard in its light variant (volume and revenue,
 *                 no margins — the API strips those for this role)
 *  - caissier   → supermarket: their own dashboard (today's and this week's sales, their till, their latest
 *                 tickets; selling is the "Vente" tab). Electronics shop: the sales dashboard, like the vendeur
 *                 (they sell in Ventes, there is no till there)
 *  - comptable  → sales dashboard (full financial view, margins and fees)
 *  - gerant     → the home dashboard of their station (the API narrows
 *                 every figure to it)
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !!user?.organization_id,
  });

  if (user?.role === 'gerant') {
    return <GerantHome />;
  }
  if (user?.role === 'magasinier') {
    return <MagasinierDashboard />;
  }
  if (user?.role === 'caissier' && (!org?.sector || isSupermarket(org.sector))) {
    return <CashierHome />;
  }

  // Seller (and legacy cashier accounts) get the full dashboard, margins included.
  return <SalesDashboardPage />;
}
