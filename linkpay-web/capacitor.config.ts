import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.linkpay.app',
  appName: 'LinkPay',
  webDir: 'dist',
  // No server.url — the app bundles dist/ directly (default behavior),
  // rather than pointing at a remote URL (that's a live-reload dev pattern).
  android: {
    allowMixedContent: false,
  },
};

export default config;
