import { create } from 'zustand';

interface StockPasswordPromptState {
  open: boolean;
  resolve: ((password: string | null) => void) | null;
  ask: () => Promise<string | null>;
  answer: (password: string | null) => void;
}

/** Drives the "stock management password" dialog when the API asks for it (add stock, movements, inventory). */
export const useStockPasswordPrompt = create<StockPasswordPromptState>((set, get) => ({
  open: false,
  resolve: null,
  ask: () =>
    new Promise<string | null>((resolve) => {
      get().resolve?.(null);
      set({ open: true, resolve });
    }),
  answer: (password) => {
    get().resolve?.(password);
    set({ open: false, resolve: null });
  },
}));

// The password the user just gave is remembered in memory for a few minutes, so
// a stock keeper entering a batch of receptions types it once. Never stored on disk.
const TTL_MS = 5 * 60_000;
let cached: { value: string; until: number } | null = null;
export const rememberStockPassword = (value: string) => { cached = { value, until: Date.now() + TTL_MS }; };
export const recalledStockPassword = () => (cached && Date.now() < cached.until ? cached.value : null);
export const forgetStockPassword = () => { cached = null; };
