import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { useEffect } from 'react';

import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/auth/LoginPage';
import RegisterPage from '@/pages/auth/RegisterPage';

import PaymentLinkPage from '@/pages/public/PaymentLinkPage';
import PaymentResultPage from '@/pages/public/PaymentResultPage';

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
import PayInvoicePage from '@/pages/wallet/Pay';
import WithdrawPage from '@/pages/wallet/Withdraw';
import SetPinPage from '@/pages/wallet/SetPin';
import WalletTransactionsPage from '@/pages/wallet/Transactions';

import AdminDashboard from '@/pages/admin/Dashboard';
import AdminMerchantsPage from '@/pages/admin/Merchants';
import AdminUsersPage from '@/pages/admin/Users';
import AdminSettlementsPage from '@/pages/admin/Settlements';
import AdminCommissionsPage from '@/pages/admin/Commissions';
import OrganizationProfilePage from '@/pages/OrganizationProfile';
import SettingsPage from '@/pages/Settings';
import InstallPrompt from '@/components/InstallPrompt';

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

  useEffect(() => {
    if (isAuthenticated) {
      fetchProfile();
    }
  }, [fetchProfile, isAuthenticated]);

  return (
    <>
      <InstallPrompt />
      <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/p/:token" element={<PaymentLinkPage />} />
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
        <Route path="wallet/pay" element={<PayInvoicePage />} />
        <Route path="wallet/withdraw" element={<WithdrawPage />} />
        <Route path="wallet/pin" element={<SetPinPage />} />
        <Route path="wallet/transactions" element={<WalletTransactionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
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
          path="organization"
          element={
            <ProtectedRoute roles={['enterprise']}>
              <OrganizationProfilePage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
