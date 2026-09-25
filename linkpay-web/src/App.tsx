import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/lib/auth-store';
import { useEffect } from 'react';
import { initNativePushNavigation } from '@/lib/native-push';

import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';
import WelcomePage from '@/pages/WelcomePage';
import { useMediaQuery } from '@/hooks/useMediaQuery';

import PaymentLinkPage from '@/pages/public/PaymentLinkPage';
import PaymentResultPage from '@/pages/public/PaymentResultPage';
import PayByNumber from '@/pages/public/PayByNumber';

import DashboardLayout from '@/layouts/DashboardLayout';
import MerchantDashboard from '@/pages/merchant/Dashboard';
import PaymentRequestsPage from '@/pages/merchant/PaymentRequests';
import CreatePaymentRequestPage from '@/pages/merchant/CreatePaymentRequest';
import MerchantTransactionsPage from '@/pages/merchant/Transactions';
import SettlementsPage from '@/pages/merchant/Settlements';
import TeamPage from '@/pages/merchant/Team';

import ClientDashboard from '@/pages/client/Dashboard';
import ClientTransactionsPage from '@/pages/client/Transactions';
import TopupPage from '@/pages/wallet/Topup';
import TopupResultPage from '@/pages/wallet/TopupResult';
import SendPage from '@/pages/wallet/Send';
import ReceivePage from '@/pages/wallet/Receive';
import SavingsPotPage from '@/pages/wallet/SavingsPot';
import ExpenseTrackerPage from '@/pages/expense-tracker/ExpenseTracker';
import ProActivationResultPage from '@/pages/expense-tracker/ProActivationResult';
import TontinesListPage from '@/pages/client/tontines/TontinesList';
import CreateTontinePage from '@/pages/client/tontines/CreateTontine';
import TontineDetailPage from '@/pages/client/tontines/TontineDetail';
import TontineSettingsPage from '@/pages/client/tontines/TontineSettings';
import PayInvoicePage from '@/pages/wallet/Pay';
import ScanQrPage from '@/pages/wallet/ScanQr';
import WithdrawPage from '@/pages/wallet/Withdraw';
import SetPinPage from '@/pages/wallet/SetPin';
import WalletTransactionsPage from '@/pages/wallet/Transactions';

import AdminDashboard from '@/pages/admin/Dashboard';
import AdminMerchantsPage from '@/pages/admin/Merchants';
import AdminUsersPage from '@/pages/admin/Users';
import AdminSettlementsPage from '@/pages/admin/Settlements';
import AdminCommissionsPage from '@/pages/admin/Commissions';
import ExpenseTrackerSettingsPage from '@/pages/admin/ExpenseTrackerSettings';
import OrganizationProfilePage from '@/pages/OrganizationProfile';
import SettingsPage from '@/pages/Settings';
import ProfilePage from '@/pages/Profile';
import InstallPrompt from '@/components/InstallPrompt';
import { AppLockGate } from '@/components/AppLockGate';

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
  // Enterprise accounts aren't linked to a merchant_id yet (no multi-store
  // support), so MerchantDashboard's stats calls would 404 for them.
  if (user.role === 'enterprise') return <Navigate to="/dashboard/organization" replace />;
  return <MerchantDashboard />;
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
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
      <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/p/:token" element={<PaymentLinkPage />} />
      <Route path="/pay/:number" element={<PayByNumber />} />
      <Route path="/payment/result" element={<PaymentResultPage />} />

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
        <Route path="settlements" element={<SettlementsPage />} />
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
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
    </>
  );
}
