import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'TechDesk – Service-Techniker App',
        short_name: 'TechDesk',
        description: 'Kalender, Berichte, FSM-Texte, Reiseplanung und Zeiterfassung für Servicetechniker',
        lang: 'de',
        theme_color: '#1E2B50',
        background_color: '#F5F6F9',
        display: 'standalone',
        start_url: './',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg}'], maximumFileSizeToCacheInBytes: 5_000_000 },
    }),
  ],
  test: { environment: 'node' },
});
