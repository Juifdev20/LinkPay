import { create } from 'zustand';

/**
 * Tracks whether a FormSheet is currently open — read by BottomNav to hide
 * itself while a sheet is up, independent of where in the component tree
 * the sheet actually renders (avoids threading a prop through
 * DashboardLayout for every page that might open one).
 */
interface SheetState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSheetStore = create<SheetState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
