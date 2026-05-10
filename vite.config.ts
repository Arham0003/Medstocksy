import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/", // Ensure base path is correctly set
  envDir: "./src/db conn",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // we register via the PWA prompts component
      includeAssets: ['robots.txt', 'apple-touch-icon.png', 'favicon.png'],
      manifest: {
        id: '/',
        name: 'Medstocksy Inventory',
        short_name: 'Medstocksy',
        description: 'Inventory management for modern medical stores — sales, purchases, returns, suppliers, and reports.',
        theme_color: '#ea580c',
        background_color: '#ffffff',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui', 'browser'],
        orientation: 'any',
        scope: '/',
        start_url: '/',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'medical', 'productivity'],
        prefer_related_applications: false,
        icons: [
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'New sale',        short_name: 'Sale',     url: '/sales/new',       description: 'Record a new sale' },
          { name: 'Products',        short_name: 'Products', url: '/products',        description: 'Manage products and stock' },
          { name: 'Purchase return', short_name: 'Returns',  url: '/purchase-return', description: 'Return products to a supplier' },
          { name: 'Reports',         short_name: 'Reports',  url: '/reports',         description: 'View sales reports' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false, // wait for user to confirm "Reload" before applying an update
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Navigation requests: try network first, fall back to cached index.html
            // Improves reload freshness while keeping a fast offline fallback.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // disable dev SW logs during development; enable only when testing PWA
        type: 'module',
        navigateFallback: 'index.html',
      },
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Reduce the chunk size warning limit
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-components': ['lucide-react'],
          'supabase': ['@supabase/supabase-js'],
          'utils': ['clsx', 'tailwind-merge', 'class-variance-authority'],
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'charts': ['recharts'],
          'date-utils': ['date-fns'],
          'virtualization': ['react-window', 'react-virtualized-auto-sizer'],
        }
      }
    }
  }
}));