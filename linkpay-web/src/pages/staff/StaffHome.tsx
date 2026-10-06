import { useAuthStore } from '@/lib/auth-store';
import StockPage from '@/pages/organization/Stock';
import SalesDashboardPage from '@/pages/organization/SalesDashboard';

/**
 * Landing screen for enterprise-internal staff (organization-staff module).
 * Each role gets the screen built for its job, with the sidebar entries
 * defined per role in lib/nav-items.ts:
 *  - magasinier → Stock & Approvisionnement (full stock management)
 *  - vendeur    → sales dashboard in its light variant (volume and revenue,
 *                 no margins — the API strips those for this role)
 *  - caissier   → sales dashboard (full revenue view, transactions, receive)
 *  - comptable  → sales dashboard (full financial view, margins and fees)
 */
export default function StaffHome() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'magasinier') {
    return <StockPage />;
  }

  return <SalesDashboardPage variant={user?.role === 'vendeur' ? 'light' : 'full'} />;
}
