import { create } from 'zustand';

interface AppCodePromptState {
  open: boolean;
  message: string;
  resolve: ((code: string | null) => void) | null;
  ask: (message?: string) => Promise<string | null>;
  answer: (code: string | null) => void;
}

/** Drives the "confirm with your access code" dialog; api.ts awaits ask() when the API demands a confirmation. */
export const useAppCodePrompt = create<AppCodePromptState>((set, get) => ({
  open: false,
  message: '',
  resolve: null,
  ask: (message = '') =>
    new Promise<string | null>((resolve) => {
      get().resolve?.(null);
      set({ open: true, message, resolve });
    }),
  answer: (code) => {
    get().resolve?.(code);
    set({ open: false, message: '', resolve: null });
  },
}));
