import { create } from 'zustand';
import api from './api';
import { supabase } from './supabase';
import { getDeviceId } from './device';
import { getToken, setTokens, setAccessToken, clearTokens, setRememberMe, TOKEN_ACCESS_KEY } from './token-storage';

interface User {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  role: string;
  merchant_id?: string;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    phone?: string;
    account_type?: 'client' | 'merchant';
    business_name?: string;
  }, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  applyMerchantUpgrade: (merchant: { id: string }, accessToken: string) => void;
  applyEnterpriseUpgrade: (accessToken: string) => void;
}

// Wires up the Supabase Realtime client with the session the backend mints
// alongside its own custom JWT (see auth.service.ts login()/register()).
// Best-effort: Realtime is a nice-to-have, never block auth on it.
function applySupabaseSession(session?: SupabaseSession | null) {
  if (!session) return;
  localStorage.setItem('linkpay_supabase_access_token', session.access_token);
  localStorage.setItem('linkpay_supabase_refresh_token', session.refresh_token);
  supabase?.auth.setSession(session).catch(() => null);
}

function clearSupabaseSession() {
  localStorage.removeItem('linkpay_supabase_access_token');
  localStorage.removeItem('linkpay_supabase_refresh_token');
  supabase?.auth.signOut().catch(() => null);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!getToken(TOKEN_ACCESS_KEY),
  isLoading: false,

  login: async (email: string, password: string, rememberMe = true) => {
    const { data } = await api.post('/auth/login', { email, password, device_id: getDeviceId() });
    setRememberMe(rememberMe);
    setTokens(data.access_token, data.refresh_token);
    applySupabaseSession(data.supabase_session);
    set({ user: data.user, isAuthenticated: true });
  },

  register: async (data, rememberMe = true) => {
    const res = await api.post('/auth/register', { ...data, device_id: getDeviceId() });
    setRememberMe(rememberMe);
    setTokens(res.data.access_token, res.data.refresh_token);
    applySupabaseSession(res.data.supabase_session);
    set({ user: res.data.user, isAuthenticated: true });
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

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Still clear local state even if the request fails (offline, token
      // already invalid, etc.) — the point is to let this device forget it.
    }
    clearTokens();
    clearSupabaseSession();
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
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
