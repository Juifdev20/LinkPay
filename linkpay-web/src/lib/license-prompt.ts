import { create } from 'zustand';

interface LicensePromptState {
  open: boolean;
  info: { feature?: string; feature_name?: string; reason?: string; mode?: string; message?: string } | null;
  show: (info: LicensePromptState['info']) => void;
  close: () => void;
}

/** Driven by api.ts when the API answers 403 LICENSE_REQUIRED. */
export const useLicensePrompt = create<LicensePromptState>((set) => ({
  open: false,
  info: null,
  show: (info) => set({ open: true, info }),
  close: () => set({ open: false }),
}));
