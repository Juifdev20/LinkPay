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
