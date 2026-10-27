import { create } from 'zustand';

export interface CashUnlockTarget {
  merchantId: string;
  closingId: string;
  /** Why the sheet opens (the API's answer), shown above the form. */
  message?: string;
}

interface CashUnlockState {
  target: CashUnlockTarget | null;
  resolve: ((unlocked: boolean) => void) | null;
  ask: (target: CashUnlockTarget) => Promise<boolean>;
  answer: (unlocked: boolean) => void;
}

/**
 * Drives the emergency-unlock sheet (secret code + reason). api.ts awaits ask() when a sale or a till action is refused
 * because the day is closed, and repeats the request once the day is unlocked; the Caisse screen uses it too.
 */
export const useCashUnlockPrompt = create<CashUnlockState>((set, get) => ({
  target: null,
  resolve: null,
  ask: (target) =>
    new Promise<boolean>((resolve) => {
      get().resolve?.(false);
      set({ target, resolve });
    }),
  answer: (unlocked) => {
    get().resolve?.(unlocked);
    set({ target: null, resolve: null });
  },
}));
