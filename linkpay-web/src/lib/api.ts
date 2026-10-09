import axios from 'axios';
import { useOtpPrompt } from './otp-prompt';
import { useAppCodePrompt } from './app-code-prompt';
import { getConfirmToken, setConfirmToken, clearConfirmToken } from './confirm-token';
import { getToken, setTokens, clearTokens, TOKEN_ACCESS_KEY, TOKEN_REFRESH_KEY } from './token-storage';

const rawUrl = (import.meta.env.VITE_API_URL || '/api/v1').toString().replace(/\/$/, '');
const API_URL = rawUrl.endsWith('/api/v1') ? rawUrl : `${rawUrl}/api/v1`;

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getToken(TOKEN_ACCESS_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Sent whenever the user confirmed with their access code in the last 5 minutes.
  const confirm = getConfirmToken();
  if (confirm) config.headers['x-confirm-token'] = confirm;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403) {
      const code = error.response.data?.code;
      // Sensitive admin action: ask for a fresh authenticator code, then repeat
      // the request with it (up to 3 tries if the code is wrong).
      if ((code === 'OTP_STEP_UP_REQUIRED' || code === 'OTP_STEP_UP_INVALID') && (error.config._otpTries ?? 0) < 3) {
        error.config._otpTries = (error.config._otpTries ?? 0) + 1;
        const otp = await useOtpPrompt.getState().ask(code === 'OTP_STEP_UP_INVALID');
        if (otp) {
          error.config.headers['x-otp-code'] = otp;
          return api(error.config);
        }
      }
      // Sensitive action (stock, inventory, till): ask for the user's own
      // access code, trade it for a 5-minute confirmation token, then repeat
      // the request. Up to 3 wrong codes before giving up.
      if (code === 'APP_CODE_CONFIRM_REQUIRED' && !error.config._confirmed) {
        clearConfirmToken();
        let message = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          const typed = await useAppCodePrompt.getState().ask(message);
          if (!typed) break;
          try {
            const { data } = await api.post('/auth/app-code/confirm', { code: typed });
            setConfirmToken(data.confirmation_token, data.expires_in);
            error.config._confirmed = true;
            error.config.headers['x-confirm-token'] = data.confirmation_token;
            return api(error.config);
          } catch (confirmErr: any) {
            const d = confirmErr?.response?.data;
            if (d?.code === 'SESSION_TERMINATED') { clearTokens(); window.location.href = '/login'; break; }
            message = d?.message || 'Code incorrect.';
            if (confirmErr?.response?.status === 429) break; // locked: the error below tells the user
          }
        }
      }
      // An administrator session without the second factor can only set it up.
      if (code === 'MFA_REQUIRED' && window.location.pathname !== '/admin-2fa') {
        window.location.href = '/admin-2fa';
      }
    }
    if (error.response?.status === 401) {
      const refreshToken = getToken(TOKEN_REFRESH_KEY);
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          setTokens(data.access_token, data.refresh_token);
          error.config.headers.Authorization = `Bearer ${data.access_token}`;
          return api(error.config);
        } catch (refreshErr: any) {
          // Only a real rejection from the server (the refresh token is
          // actually dead — explicit logout or an admin reset happened)
          // means this device should be logged out. A network-level
          // failure (offline, timeout, DNS, a momentary 5xx) never reached
          // the server at all — the refresh token is still perfectly
          // valid, we just couldn't ask right now. Wiping the session on
          // every dropped connection is exactly what was silently
          // "forgetting" users on flaky mobile networks — keep the tokens
          // and let the next request retry naturally instead.
          if (refreshErr.response?.status === 401) {
            clearTokens();
            window.location.href = '/login';
          }
        }
      } else if (!refreshToken) {
        // No refresh token ever existed — genuinely not logged in.
        clearTokens();
        if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/p/')) {
          window.location.href = '/login';
        }
      }
      // else: this request had already been retried once after a refresh
      // and still got a 401 — don't force a logout for what may be a
      // transient/isolated failure; just let it surface to the caller.
    }
    return Promise.reject(error);
  },
);

export default api;
