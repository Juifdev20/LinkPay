import { create } from 'zustand';

interface OtpPromptState {
  open: boolean;
  invalid: boolean;
  resolve: ((code: string | null) => void) | null;
  ask: (invalid?: boolean) => Promise<string | null>;
  answer: (code: string | null) => void;
}

/**
 * Sensitive admin actions (roles, commissions, limits, 2FA reset) need a fresh
 * authenticator code. The API answers 403 OTP_STEP_UP_REQUIRED; api.ts calls
 * ask() to show the dialog, then repeats the request with the code.
 */
export const useOtpPrompt = create<OtpPromptState>((set, get) => ({
  open: false,
  invalid: false,
  resolve: null,
  ask: (invalid = false) =>
    new Promise<string | null>((resolve) => {
      get().resolve?.(null); // a second prompt supersedes an unanswered one
      set({ open: true, invalid, resolve });
    }),
  answer: (code) => {
    get().resolve?.(code);
    set({ open: false, invalid: false, resolve: null });
  },
}));
