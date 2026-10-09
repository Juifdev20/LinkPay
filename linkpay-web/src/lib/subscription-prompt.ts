import { create } from 'zustand';

interface SubscriptionPromptState {
  open: boolean;
  info: { reason?: string; mode?: string; message?: string } | null;
  show: (info: SubscriptionPromptState['info']) => void;
  close: () => void;
}

/** Driven by api.ts when the API answers 403 SUBSCRIPTION_REQUIRED. */
export const useSubscriptionPrompt = create<SubscriptionPromptState>((set) => ({
  open: false,
  info: null,
  show: (info) => set({ open: true, info }),
  close: () => set({ open: false }),
}));
