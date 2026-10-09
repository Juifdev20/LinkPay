import { create } from 'zustand';
import api from './api';
import { supabase } from './supabase';
import { getDeviceId } from './device';
import {
  getToken,
  hasSession as hasStoredSession,
  setTokens,
  setAccessToken,
  clearTokens,
  setRememberMe,
  stashOrgContextTokens,
  popOrgContextTokens,
  TOKEN_ACCESS_KEY,
  TOKEN_REFRESH_KEY,
  getCachedUser,
  setCachedUser,
  forgetSessionSecrets,
} from './token-storage';
import { clearAppLockLocal } from './webauthn';
import { queryClient } from './query-client';
import { useAppLock } from './app-lock-store';
import { COOKIE_AUTH } from './auth-mode';
import { runDeviceCheck } from './device-integrity';

interface User {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  role: string;
  merchant_id?: string;
  /** Set for enterprise-internal staff (magasinier/vendeur/caissier/
   * comptable) — the organization they belong to, since they aren't its
   * owner (see organization-staff module). */
  organization_id?: string;
  /** Set while "acting as" one of an organization's stores — see
   * enterStore()/exitStore() below. */
  acting_as_org_id?: string;
  /** True until this account's forced first-login password change is done
   * — set on enterprise-staff accounts created via OrganizationStaffService.
   * See ForcePasswordChangeGate.tsx, mounted once in App.tsx. */
  must_change_password?: boolean;
  /** Administrators only: no authenticator set up yet (from login). */
  two_factor_setup_required?: boolean;
  /** Administrators only: this session has passed the authenticator check (from /users/me). */
  mfa_verified?: boolean;
  /** Whether the user has chosen their 6-digit access code (from /users/me). */
  has_app_code?: boolean;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean, otp?: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    phone?: string;
    account_type?: 'client' | 'merchant' | 'enterprise';
    business_name?: string;
  }, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  // Token arguments are undefined in cookie mode (the session is in HttpOnly cookies, not in the response).
  applyMerchantUpgrade: (merchant: { id: string }, accessToken?: string) => void;
  applyEnterpriseUpgrade: (accessToken?: string) => void;
  enterStore: (merchant: { id: string }, accessToken: string | undefined, refreshToken: string | undefined, organizationId: string) => void;
  exitStore: () => Promise<void>;
  clearMustChangePassword: () => void;
}

// Wires up the Supabase Realtime client with the session the backend mints
// alongside its own custom JWT (see auth.service.ts login()/register()).
// Best-effort: Realtime is a nice-to-have, never block auth on it.
function applySupabaseSession(session?: SupabaseSession | null) {
  // Cookie mode: the API withholds it (it is a second login to the same account that a script could steal and keep).
  if (!session || COOKIE_AUTH) return;
  localStorage.setItem('linkpay_supabase_access_token', session.access_token);
  localStorage.setItem('linkpay_supabase_refresh_token', session.refresh_token);
  supabase?.auth.setSession(session).catch(() => null);
}

function clearSupabaseSession() {
  localStorage.removeItem('linkpay_supabase_access_token');
  localStorage.removeItem('linkpay_supabase_refresh_token');
  supabase?.auth.signOut().catch(() => null);
}

const hasSession = hasStoredSession();

export const useAuthStore = create<AuthState>((set) => ({
  // Last known profile: screens render at once on launch while
  // fetchProfile() refreshes it in the background (App.tsx).
  user: hasSession ? getCachedUser<User>() : null,
  isAuthenticated: hasSession,
  isLoading: false,

  login: async (email: string, password: string, rememberMe = true, otp?: string) => {
    // Cookie mode: the API sets session cookies (or persistent ones) according to this choice, so it must be known first.
    if (COOKIE_AUTH) setRememberMe(rememberMe);
    const { data } = await api.post('/auth/login', { email, password, device_id: getDeviceId(), ...(otp ? { otp } : {}) });
    queryClient.clear(); // never show another account's cached data
    forgetSessionSecrets(); // …nor inherit the previous person's stock password / confirmation
    setRememberMe(rememberMe);
    setTokens(data.access_token, data.refresh_token);
    applySupabaseSession(data.supabase_session);
    useAppLock.getState().unlock(); // the password was just typed: no need to ask for the code too
    set({ user: data.user, isAuthenticated: true });
    void runDeviceCheck(); // Android app: verify the phone in the background (no-op elsewhere)
  },

  register: async (data, rememberMe = true) => {
    if (COOKIE_AUTH) setRememberMe(rememberMe);
    const res = await api.post('/auth/register', { ...data, device_id: getDeviceId() });
    queryClient.clear();
    forgetSessionSecrets();
    setRememberMe(rememberMe);
    setTokens(res.data.access_token, res.data.refresh_token);
    applySupabaseSession(res.data.supabase_session);
    useAppLock.getState().unlock();
    set({ user: res.data.user, isAuthenticated: true });
    void runDeviceCheck();
  },

  applyMerchantUpgrade: (merchant, accessToken) => {
    setAccessToken(accessToken);
    set((state) => ({
      user: state.user ? { ...state.user, role: 'merchant', merchant_id: merchant.id } : state.user,
    }));
  },

  applyEnterpriseUpgrade: (accessToken) => {
    setAccessToken(accessToken);
    set((state) => ({
      user: state.user ? { ...state.user, role: 'enterprise' } : state.user,
    }));
  },

  enterStore: (merchant, accessToken, refreshToken, organizationId) => {
    // Full pair swap, not setAccessToken-only like applyMerchantUpgrade:
    // the OLD (org-scoped) refresh token must not stay live in the primary
    // slot, or a stray 401 before this finishes could re-derive an
    // enterprise-scoped access token underneath the store-scoped one just
    // set here. Stash it first so "back to organization" can restore it.
    const currentAccess = getToken(TOKEN_ACCESS_KEY);
    const currentRefresh = getToken(TOKEN_REFRESH_KEY);
    if (currentAccess && currentRefresh) {
      stashOrgContextTokens(currentAccess, currentRefresh);
    }
    // Cookie mode: the API already replaced the cookies; "back to the organization" asks the API for the owner session again.
    setTokens(accessToken, refreshToken);
    set((state) => ({
      user: state.user
        ? { ...state.user, role: 'merchant', merchant_id: merchant.id, acting_as_org_id: organizationId }
        : state.user,
    }));
  },

  clearMustChangePassword: () => {
    set((state) => ({
      user: state.user ? { ...state.user, must_change_password: false } : state.user,
    }));
  },

  exitStore: async () => {
    if (COOKIE_AUTH) {
      // The owner's tokens were never in JavaScript, so the API re-derives them (and swaps the cookies).
      await api.post('/auth/exit-store');
    } else {
      const orgTokens = popOrgContextTokens();
      if (orgTokens) setTokens(orgTokens.access, orgTokens.refresh);
    }
    set((state) => ({
      user: state.user ? { ...state.user, role: 'enterprise', merchant_id: undefined, acting_as_org_id: undefined } : state.user,
    }));
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Still clear local state even if the request fails (offline, token
      // already invalid, etc.) — the point is to let this device forget it.
    }
    clearTokens();
    clearSupabaseSession();
    // A fresh login on this device/browser (possibly a different account)
    // must never inherit a stale "locked" state or attempt a WebAuthn
    // ceremony tied to the previous user's credential.
    clearAppLockLocal();
    // In-memory data too, or the persister would write it back.
    queryClient.clear();
    set({ user: null, isAuthenticated: false });
  },

  fetchProfile: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get('/users/me');
      const supaAccess = localStorage.getItem('linkpay_supabase_access_token');
      const supaRefresh = localStorage.getItem('linkpay_supabase_refresh_token');
      if (supaAccess && supaRefresh) {
        applySupabaseSession({ access_token: supaAccess, refresh_token: supaRefresh });
      }
      set({ user: data, isAuthenticated: true, isLoading: false });
    } catch (err: any) {
      // Only a real 401 means "this session is genuinely dead" — the axios
      // interceptor already retried with the refresh token by then (and
      // clears tokens + redirects itself if that also failed). Anything
      // else — backend restarting, offline, timeout, 5xx — is transient:
      // keep the stored session instead of throwing the user back to the
      // login page for a hiccup. Same philosophy as the interceptor's own
      // "a network failure must not wipe the session" fix.
      if (err?.response?.status === 401) {
        set({ user: null, isAuthenticated: false, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    }
  },
}));

// Keep the cached profile in step with every change (login, refresh, store
// switch, password change…) — and drop it when the user is cleared.
useAuthStore.subscribe((state, prev) => {
  if (state.user !== prev.user) setCachedUser(state.user);
});
