import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (not the default generateSW) — required to add custom
      // runtime code (push / notificationclick listeners) to the service
      // worker. See src/sw.ts for the precaching + runtime caching + push
      // logic that generateSW used to handle automatically via `workbox`.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'LinkPay',
        short_name: 'LinkPay',
        description: 'Plateforme de paiement LinkPay — Paiements par lien et QR code',
        theme_color: '#4F46E5',
        background_color: '#4F46E5',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'fr',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        // Long-press the installed icon → quick actions, without opening the
        // app first. Android/desktop Chrome support this today; ignored
        // elsewhere (never an error).
        shortcuts: [
          {
            name: 'Recharger',
            short_name: 'Recharger',
            url: '/dashboard/wallet/topup',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Envoyer',
            short_name: 'Envoyer',
            url: '/dashboard/wallet/send',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: {
        // The custom SW isn't built/served under plain `vite dev` — test
        // push/precaching via `npm run build && npm run preview`.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Default is 4096 bytes — raised so src/assets/logo.png (~51KB) actually
    // gets inlined as a base64 data URI wherever it's imported (Logo.tsx,
    // InstallPrompt.tsx), instead of becoming a separate network-fetched
    // file. The whole point is a brand mark that can never show as a broken
    // image, online or off, cache or no cache — bundled into the app itself
    // like a native app's icon, not something that can fail to load.
    assetsInlineLimit: 60_000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
