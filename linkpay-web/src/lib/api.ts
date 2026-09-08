import axios from 'axios';

const rawUrl = (import.meta.env.VITE_API_URL || '/api/v1').toString().replace(/\/$/, '');
const API_URL = rawUrl.endsWith('/api/v1') ? rawUrl : `${rawUrl}/api/v1`;

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('linkpay_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('linkpay_refresh_token');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          localStorage.setItem('linkpay_access_token', data.access_token);
          localStorage.setItem('linkpay_refresh_token', data.refresh_token);
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
            localStorage.removeItem('linkpay_access_token');
            localStorage.removeItem('linkpay_refresh_token');
            window.location.href = '/login';
          }
        }
      } else if (!refreshToken) {
        // No refresh token ever existed — genuinely not logged in.
        localStorage.removeItem('linkpay_access_token');
        localStorage.removeItem('linkpay_refresh_token');
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
