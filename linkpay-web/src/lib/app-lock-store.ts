import { create } from 'zustand';
import { getToken, TOKEN_ACCESS_KEY } from './token-storage';

/**
 * When the app asks for the access code again.
 *   - on every launch, as soon as a session exists (cold start);
 *   - when the app was in the background for more than BACKGROUND_LOCK_MS
 *     (a short grace period so the camera permission dialog, a file picker or
 *     a quick app switch don't lock you out);
 *   - after the user has not touched the app for the chosen idle delay.
 * Change the defaults here; the user can pick a shorter or longer idle delay in
 * Settings among IDLE_CHOICES_MIN.
 */
export const BACKGROUND_LOCK_MS = 15_000;
export const IDLE_CHOICES_MIN = [1, 3, 5, 15] as const;
export const DEFAULT_IDLE_MIN = 3;
const IDLE_KEY = 'linkpay_idle_lock_min';

export function getIdleLockMinutes(): number {
  try {
    const v = Number(localStorage.getItem(IDLE_KEY));
    return (IDLE_CHOICES_MIN as readonly number[]).includes(v) ? v : DEFAULT_IDLE_MIN;
  } catch {
    return DEFAULT_IDLE_MIN;
  }
}

export function setIdleLockMinutes(min: number) {
  try {
    localStorage.setItem(IDLE_KEY, String(min));
  } catch { /* storage unavailable: the default applies */ }
}

/**
 * Who is asked for the access code: clients, merchants and business owners.
 * NOT the staff who work the tills and the stock (vendeur, caissier,
 * magasinier, comptable, merchant cashiers) and not the administrators (they
 * have the authenticator-app login) — a code prompt in the middle of a sale
 * would only get in the way.
 */
export const APP_CODE_ROLES = ['client', 'merchant', 'enterprise'];
export const appCodeApplies = (role?: string) => !!role && APP_CODE_ROLES.includes(role);

/**
 * Screens where the code is never asked, even for the roles above: the
 * selling and stock screens (till, sales, stock, inventory) and the merchant's
 * "Encaisser" screens, which stay open for hours while customers pay. The app
 * still remembers that it should be locked, so the code is asked the moment
 * the user leaves those screens for any other one.
 */
export const SALES_ROUTE_PREFIXES = [
  '/dashboard/pos',
  '/dashboard/organization/sales',
  '/dashboard/organization/stock',
  '/dashboard/organization/inventory',
  '/dashboard/payment-requests',
];
export const isSalesRoute = (pathname: string) =>
  SALES_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

interface AppLockState {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useAppLock = create<AppLockState>((set) => ({
  // A stored session at launch means "someone reopened the app": locked until the code is entered.
  locked: !!getToken(TOKEN_ACCESS_KEY),
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
