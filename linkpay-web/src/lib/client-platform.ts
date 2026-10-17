import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';

export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** Where this session runs — the API keeps it with the session (login) and applies the device rule to Android-app sessions. */
export function clientPlatform(): 'android-app' | 'ios-app' | 'desktop' | 'web' {
  if (Capacitor.isNativePlatform()) return Capacitor.getPlatform() === 'ios' ? 'ios-app' : 'android-app';
  if (typeof window !== 'undefined' && (window as any).linkpayDesktop) return 'desktop';
  return 'web';
}

interface UntrustedState {
  open: boolean;
  message: string;
  show: (message?: string) => void;
  close: () => void;
}

/** Drives the "this device is not secure" dialog (api.ts shows it when the API answers DEVICE_UNTRUSTED). */
export const useDeviceUntrusted = create<UntrustedState>((set) => ({
  open: false,
  message: '',
  show: (message) => set({ open: true, message: message || '' }),
  close: () => set({ open: false }),
}));

