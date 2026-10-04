import { create } from 'zustand';

/**
 * Tracks whether the mobile nav drawer (MobileNavDrawer.tsx) is open —
 * same shape as sheet-store.ts, read by TopBar.tsx's hamburger button and
 * the drawer itself, independent of where each renders in the tree.
 */
interface DrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
