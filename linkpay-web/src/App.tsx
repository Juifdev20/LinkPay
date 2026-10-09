import { OtpPromptDialog } from '@/components/OtpPromptDialog';
import { AppCodeConfirmDialog } from '@/components/AppCodeConfirmDialog';
import { StockPasswordGate } from '@/components/stock/StockPasswordGate';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/lib/auth-store';
import { useEffect, Suspense } from 'react';
import { lazyPage, prefetchPages, PageFallback } from '@/lib/lazy-page';
import { startScreenProtection } from '@/lib/screen-protection';
import { initNativePushNavigation } from '@/lib/native-push';

import LoginPage from '@/pages/auth/LoginPage';
const RegisterPage = lazyPage(() => import('@/pages/auth/RegisterPage'));
import WelcomePage from '@/pages/WelcomePage';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const PaymentLinkPage = lazyPage(() => import('@/pages/public/PaymentLinkPage'));
const PaymentResultPage = lazyPage(() => import('@/pages/public/PaymentResultPage'));
const PayByNumber = lazyPage(() => import('@/pages/public/PayByNumber'));

import DashboardLayout from '@/layouts/DashboardLayout';
import MerchantDashboard from '@/pages/merchant/Dashboard';
const PaymentRequestsPage = lazyPage(() => import('@/pages/merchant/PaymentRequests'));
const CreatePaymentRequestPage = lazyPage(() => import('@/pages/merchant/CreatePaymentRequest'));
const MerchantTransactionsPage = lazyPage(() => import('@/pages/merchant/Transactions'));
const TeamPage = lazyPage(() => import('@/pages/merchant/Team'));

import ClientDashboard from '@/pages/client/Dashboard';
const ClientTransactionsPage = lazyPage(() => import('@/pages/client/Transactions'));
const TopupPage = lazyPage(() => import('@/pages/wallet/Topup'));
const TopupResultPage = lazyPage(() => import('@/pages/wallet/TopupResult'));
const SendPage = lazyPage(() => import('@/pages/wallet/Send'));
const ReceivePage = lazyPage(() => import('@/pages/wallet/Receive'));
const SavingsPotPage = lazyPage(() => import('@/pages/wallet/SavingsPot'));
const ExpenseTrackerPage = lazyPage(() => import('@/pages/expense-tracker/ExpenseTracker'));
const ProActivationResultPage = lazyPage(() => import('@/pages/expense-tracker/ProActivationResult'));
const TontinesListPage = lazyPage(() => import('@/pages/client/tontines/TontinesList'));
const CreateTontinePage = lazyPage(() => import('@/pages/client/tontines/CreateTontine'));
const TontineDetailPage = lazyPage(() => import('@/pages/client/tontines/TontineDetail'));
const TontineSettingsPage = lazyPage(() => import('@/pages/client/tontines/TontineSettings'));
const PayInvoicePage = lazyPage(() => import('@/pages/wallet/Pay'));
const ScanQrPage = lazyPage(() => import('@/pages/wallet/ScanQr'));
const WithdrawPage = lazyPage(() => import('@/pages/wallet/Withdraw'));
const SetPinPage = lazyPage(() => import('@/pages/wallet/SetPin'));
const WalletTransactionsPage = lazyPage(() => import('@/pages/wallet/Transactions'));

const AdminDashboard = lazyPage(() => import('@/pages/admin/Dashboard'));
const AdminMerchantsPage = lazyPage(() => import('@/pages/admin/Merchants'));
const AdminUsersPage = lazyPage(() => import('@/pages/admin/Users'));
const AdminSettlementsPage = lazyPage(() => import('@/pages/admin/Settlements'));
const AdminCommissionsPage = lazyPage(() => import('@/pages/admin/Commissions'));
const AdminRiskLogsPage = lazyPage(() => import('@/pages/admin/RiskLogs'));
const AdminTwoFactorSetupPage = lazyPage(() => import('@/pages/auth/AdminTwoFactorSetup'));
const AdminWalletLimitsPage = lazyPage(() => import('@/pages/admin/WalletLimits'));
const ExpenseTrackerSettingsPage = lazyPage(() => import('@/pages/admin/ExpenseTrackerSettings'));
const AppSecurityPage = lazyPage(() => import('@/pages/admin/AppSecurity'));
const AdminOrganizationsPage = lazyPage(() => import('@/pages/admin/Organizations'));
import OrganizationProfilePage from '@/pages/OrganizationProfile';
const StaffPage = lazyPage(() => import('@/pages/organization/Staff'));
const StoresPage = lazyPage(() => import('@/pages/organization/Stores'));
const StockPage = lazyPage(() => import('@/pages/organization/Stock'));
const InventoryPage = lazyPage(() => import('@/pages/organization/Inventory'));
const SalesStatsPage = lazyPage(() => import('@/pages/organization/SalesStats'));
const AuditLogPage = lazyPage(() => import('@/pages/organization/AuditLog'));
const PosPage = lazyPage(() => import('@/pages/pos/PosPage'));
const SalesPage = lazyPage(() => import('@/pages/organization/Sales'));
const SalesDashboardPage = lazyPage(() => import('@/pages/organization/SalesDashboard'));
const SalesHistoryPage = lazyPage(() => import('@/pages/organization/SalesHistory'));
const CompanyProfilePage = lazyPage(() => import('@/pages/organization/CompanyProfile'));
const OrganizationTransactionsPage = lazyPage(() => import('@/pages/organization/Transactions'));
const OrganizationReceivePage = lazyPage(() => import('@/pages/organization/Receive'));
import StaffHome from '@/pages/staff/StaffHome';
const SettingsPage = lazyPage(() => import('@/pages/Settings'));
const NotificationsPage = lazyPage(() => import('@/pages/Notifications'));
const MorePage = lazyPage(() => import('@/pages/More'));
const ProfilePage = lazyPage(() => import('@/pages/Profile'));
import InstallPrompt from '@/components/InstallPrompt';
import { AppLockGate } from '@/components/AppLockGate';
import { ForcePasswordChangeGate } from '@/components/ForcePasswordChangeGate';

const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

// No marketing landing page in this app (feature grid, nav bar, etc. — that's
// for the website, not a professional app). An authenticated visitor always
// goes straight to the dashboard. An unauthenticated one goes straight to
// /login on desktop (the reference design bakes the branding directly into
// that combined screen there); on mobile they first see WelcomePage — a
// brand splash with a short pitch and the two ways in — matching the
// reference's separate mobile "Welcome" screen.
function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  if (isDesktop) return <Navigate to="/login" replace />;
  return <WelcomePage />;
}

function DashboardIndex() {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;
  if (user.role === 'client') return <ClientDashboard />;
  if (user.role === 'admin' || user.role === 'super_admin') return <Navigate to="/dashboard/admin" replace />;
  // Enterprise accounts land directly on their dashboard here (not a
  // redirect to /dashboard/organization) so "Tableau de bord" in the
  // sidebar — which links to plain /dashboard — highlights correctly.
  // OrganizationProfilePage itself still branches internally on org status
  // (onboarding wizard / pending / rejected / active dashboard).
  if (user.role === 'enterprise') return <OrganizationProfilePage />;
  // Enterprise-internal staff (organization-staff module) have no
  // merchant_id either — same reasoning as enterprise above.
  if (STAFF_ROLES.includes(user.role)) return <StaffHome />;
  // An org owner acting as one of their stores: "Tableau de bord" shows the
  // organization overview — also where the "Retour à l'organisation" exit
  // banner lives.
  if (user.acting_as_org_id) return <Navigate to="/dashboard/organization" replace />;
  return <MerchantDashboard />;
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Administrators without a verified second factor can only reach the setup page.
  if (user && (user.role === 'admin' || user.role === 'super_admin') && (user.two_factor_setup_required || user.mfa_verified === false)) {
    return <Navigate to="/admin-2fa" replace />;
  }

  // An org owner acting as one of their stores keeps enterprise-level
  // access to the org module (role is 'merchant' + acting_as_org_id).
  const effectiveRole = user?.acting_as_org_id ? 'enterprise' : user?.role;
  if (roles && user && effectiveRole && !roles.includes(effectiveRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      fetchProfile();
    }
  }, [fetchProfile, isAuthenticated]);

  useEffect(() => prefetchPages(), []);

  // Super admin switch: black screenshots in the Android app (FLAG_SECURE).
  useEffect(() => startScreenProtection(), []);

  // Deep-link into the app when a delivered push notification is tapped —
  // the native counterpart of sw.ts's notificationclick handler, which only
  // runs in a real service worker context. Native-only: on web/iOS the
  // service worker already owns this.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    return initNativePushNavigation(navigate);
  }, [navigate]);

  return (
    <>
      <InstallPrompt />
      <AppLockGate />
      <ForcePasswordChangeGate />
      <OtpPromptDialog />
      <AppCodeConfirmDialog />
      <StockPasswordGate />
      <Suspense fallback={<PageFallback fullScreen />}>
      <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/p/:token" element={<PaymentLinkPage />} />
      <Route path="/pay/:number" element={<PayByNumber />} />
      <Route path="/payment/result" element={<PaymentResultPage />} />

      <Route path="/admin-2fa" element={<AdminTwoFactorSetupPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardIndex />} />
        <Route path="payment-requests" element={<PaymentRequestsPage />} />
        <Route path="payment-requests/new" element={<CreatePaymentRequestPage />} />
        <Route path="transactions" element={<MerchantTransactionsPage />} />
        <Route
          path="team"
          element={
            <ProtectedRoute roles={['merchant']}>
              <TeamPage />
            </ProtectedRoute>
          }
        />
        <Route path="client" element={<ClientDashboard />} />
        <Route path="client/transactions" element={<ClientTransactionsPage />} />
        <Route path="wallet/topup" element={<TopupPage />} />
        <Route path="wallet/topup/result" element={<TopupResultPage />} />
        <Route path="wallet/send" element={<SendPage />} />
        <Route path="wallet/receive" element={<ReceivePage />} />
        <Route path="savings" element={<SavingsPotPage />} />
        <Route
          path="expenses"
          element={
            <ProtectedRoute roles={['client', 'merchant', 'cashier', 'admin', 'super_admin']}>
              <ExpenseTrackerPage />
            </ProtectedRoute>
          }
        />
        <Route path="expenses/pro/result" element={<ProActivationResultPage />} />
        <Route path="tontines" element={<TontinesListPage />} />
        <Route path="tontines/new" element={<CreateTontinePage />} />
        <Route path="tontines/:id" element={<TontineDetailPage />} />
        <Route path="tontines/:id/settings" element={<TontineSettingsPage />} />
        <Route path="wallet/pay" element={<PayInvoicePage />} />
        <Route path="wallet/scan" element={<ScanQrPage />} />
        <Route path="wallet/withdraw" element={<WithdrawPage />} />
        <Route path="wallet/pin" element={<SetPinPage />} />
        <Route path="wallet/transactions" element={<WalletTransactionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="admin"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/merchants"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminMerchantsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/settlements"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminSettlementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/commissions"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminCommissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/security-alerts"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminRiskLogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/wallet-limits"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminWalletLimitsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/app-security"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AppSecurityPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/expense-tracker-settings"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <ExpenseTrackerSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization"
          element={
            <ProtectedRoute roles={['enterprise']}>
              <OrganizationProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/stores"
          element={
            <ProtectedRoute roles={['enterprise']}>
              <StoresPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/staff"
          element={
            <ProtectedRoute roles={['enterprise']}>
              <StaffPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/sales"
          element={
            <ProtectedRoute roles={['enterprise', 'vendeur', 'caissier']}>
              <SalesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/sales/history"
          element={
            <ProtectedRoute roles={['enterprise', 'vendeur', 'caissier', 'comptable']}>
              <SalesHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/sales/dashboard"
          element={
            <ProtectedRoute roles={['enterprise', 'vendeur', 'caissier', 'comptable']}>
              <SalesDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/stock"
          element={
            <ProtectedRoute roles={['enterprise', 'magasinier', 'vendeur']}>
              <StockPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/inventory"
          element={
            <ProtectedRoute roles={['enterprise', 'magasinier']}>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/profile"
          element={
            <ProtectedRoute roles={['enterprise']}>
              <CompanyProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/stats"
          element={
            <ProtectedRoute roles={['enterprise', 'comptable']}>
              <SalesStatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/transactions"
          element={
            <ProtectedRoute roles={['enterprise', 'caissier', 'comptable']}>
              <OrganizationTransactionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/audit"
          element={
            <ProtectedRoute roles={['enterprise', 'comptable']}>
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="organization/receive"
          element={
            <ProtectedRoute roles={['enterprise', 'caissier']}>
              <OrganizationReceivePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="pos"
          element={
            <ProtectedRoute roles={['enterprise', 'caissier', 'magasinier']}>
              <PosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/organizations"
          element={
            <ProtectedRoute roles={['admin', 'super_admin']}>
              <AdminOrganizationsPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
      </Suspense>
    </>
  );
}
