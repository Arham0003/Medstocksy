// vite.config.ts
import { defineConfig } from "file:///E:/Pivot%20New%20Work/Medstocksy-inventory-10-05-2026/app.Medstocksy-V2-10-05-26/node_modules/vite/dist/node/index.js";
import react from "file:///E:/Pivot%20New%20Work/Medstocksy-inventory-10-05-2026/app.Medstocksy-V2-10-05-26/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import { componentTagger } from "file:///E:/Pivot%20New%20Work/Medstocksy-inventory-10-05-2026/app.Medstocksy-V2-10-05-26/node_modules/lovable-tagger/dist/index.js";
import { VitePWA } from "file:///E:/Pivot%20New%20Work/Medstocksy-inventory-10-05-2026/app.Medstocksy-V2-10-05-26/node_modules/vite-plugin-pwa/dist/index.js";
var __vite_injected_original_dirname = "E:\\Pivot New Work\\Medstocksy-inventory-10-05-2026\\app.Medstocksy-V2-10-05-26";
var vite_config_default = defineConfig(({ mode }) => ({
  base: "/",
  // Ensure base path is correctly set
  envDir: "./src/db_conn",
  server: {
    host: "::",
    port: 8080
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      // we register via the PWA prompts component
      includeAssets: ["robots.txt", "apple-touch-icon.png", "favicon.png"],
      manifest: {
        id: "/",
        name: "Medstocksy Inventory",
        short_name: "Medstocksy",
        description: "Inventory management for modern medical stores \u2014 sales, purchases, returns, suppliers, and reports.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        display_override: ["standalone", "minimal-ui", "browser"],
        orientation: "any",
        scope: "/",
        start_url: "/",
        lang: "en",
        dir: "ltr",
        categories: ["business", "medical", "productivity"],
        prefer_related_applications: false,
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-512x512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        shortcuts: [
          { name: "New sale", short_name: "Sale", url: "/sales/new", description: "Record a new sale" },
          { name: "Products", short_name: "Products", url: "/products", description: "Manage products and stock" },
          { name: "Purchase return", short_name: "Returns", url: "/purchase-return", description: "Return products to a supplier" },
          { name: "Reports", short_name: "Reports", url: "/reports", description: "View sales reports" }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        // wait for user to confirm "Reload" before applying an update
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Navigation requests: try network first, fall back to cached index.html
            // Improves reload freshness while keeping a fast offline fallback.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache",
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: {
        enabled: false,
        // disable dev SW logs during development; enable only when testing PWA
        type: "module",
        navigateFallback: "index.html"
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  build: {
    // Reduce the chunk size warning limit
    chunkSizeWarningLimit: 1e3,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-components": ["lucide-react"],
          "supabase": ["@supabase/supabase-js"],
          "utils": ["clsx", "tailwind-merge", "class-variance-authority"],
          "forms": ["react-hook-form", "@hookform/resolvers", "zod"],
          "charts": ["recharts"],
          "date-utils": ["date-fns"],
          "virtualization": ["react-window", "react-virtualized-auto-sizer"]
        }
      }
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxQaXZvdCBOZXcgV29ya1xcXFxNZWRzdG9ja3N5LWludmVudG9yeS0xMC0wNS0yMDI2XFxcXGFwcC5NZWRzdG9ja3N5LVYyLTEwLTA1LTI2XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJFOlxcXFxQaXZvdCBOZXcgV29ya1xcXFxNZWRzdG9ja3N5LWludmVudG9yeS0xMC0wNS0yMDI2XFxcXGFwcC5NZWRzdG9ja3N5LVYyLTEwLTA1LTI2XFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9FOi9QaXZvdCUyME5ldyUyMFdvcmsvTWVkc3RvY2tzeS1pbnZlbnRvcnktMTAtMDUtMjAyNi9hcHAuTWVkc3RvY2tzeS1WMi0xMC0wNS0yNi92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XHJcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3Qtc3djXCI7XHJcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XHJcbmltcG9ydCB7IGNvbXBvbmVudFRhZ2dlciB9IGZyb20gXCJsb3ZhYmxlLXRhZ2dlclwiO1xyXG5pbXBvcnQgeyBWaXRlUFdBIH0gZnJvbSAndml0ZS1wbHVnaW4tcHdhJztcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XHJcbiAgYmFzZTogXCIvXCIsIC8vIEVuc3VyZSBiYXNlIHBhdGggaXMgY29ycmVjdGx5IHNldFxyXG4gIGVudkRpcjogXCIuL3NyYy9kYl9jb25uXCIsXHJcbiAgc2VydmVyOiB7XHJcbiAgICBob3N0OiBcIjo6XCIsXHJcbiAgICBwb3J0OiA4MDgwLFxyXG4gIH0sXHJcbiAgcGx1Z2luczogW1xyXG4gICAgcmVhY3QoKSxcclxuICAgIG1vZGUgPT09IFwiZGV2ZWxvcG1lbnRcIiAmJiBjb21wb25lbnRUYWdnZXIoKSxcclxuICAgIFZpdGVQV0Eoe1xyXG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcclxuICAgICAgaW5qZWN0UmVnaXN0ZXI6IGZhbHNlLCAvLyB3ZSByZWdpc3RlciB2aWEgdGhlIFBXQSBwcm9tcHRzIGNvbXBvbmVudFxyXG4gICAgICBpbmNsdWRlQXNzZXRzOiBbJ3JvYm90cy50eHQnLCAnYXBwbGUtdG91Y2gtaWNvbi5wbmcnLCAnZmF2aWNvbi5wbmcnXSxcclxuICAgICAgbWFuaWZlc3Q6IHtcclxuICAgICAgICBpZDogJy8nLFxyXG4gICAgICAgIG5hbWU6ICdNZWRzdG9ja3N5IEludmVudG9yeScsXHJcbiAgICAgICAgc2hvcnRfbmFtZTogJ01lZHN0b2Nrc3knLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnSW52ZW50b3J5IG1hbmFnZW1lbnQgZm9yIG1vZGVybiBtZWRpY2FsIHN0b3JlcyBcdTIwMTQgc2FsZXMsIHB1cmNoYXNlcywgcmV0dXJucywgc3VwcGxpZXJzLCBhbmQgcmVwb3J0cy4nLFxyXG4gICAgICAgIHRoZW1lX2NvbG9yOiAnI2ZmZmZmZicsXHJcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyNmZmZmZmYnLFxyXG4gICAgICAgIGRpc3BsYXk6ICdzdGFuZGFsb25lJyxcclxuICAgICAgICBkaXNwbGF5X292ZXJyaWRlOiBbJ3N0YW5kYWxvbmUnLCAnbWluaW1hbC11aScsICdicm93c2VyJ10sXHJcbiAgICAgICAgb3JpZW50YXRpb246ICdhbnknLFxyXG4gICAgICAgIHNjb3BlOiAnLycsXHJcbiAgICAgICAgc3RhcnRfdXJsOiAnLycsXHJcbiAgICAgICAgbGFuZzogJ2VuJyxcclxuICAgICAgICBkaXI6ICdsdHInLFxyXG4gICAgICAgIGNhdGVnb3JpZXM6IFsnYnVzaW5lc3MnLCAnbWVkaWNhbCcsICdwcm9kdWN0aXZpdHknXSxcclxuICAgICAgICBwcmVmZXJfcmVsYXRlZF9hcHBsaWNhdGlvbnM6IGZhbHNlLFxyXG4gICAgICAgIGljb25zOiBbXHJcbiAgICAgICAgICB7IHNyYzogJ3B3YS0xOTJ4MTkyLnBuZycsICAgICAgICAgIHNpemVzOiAnMTkyeDE5MicsIHR5cGU6ICdpbWFnZS9wbmcnLCBwdXJwb3NlOiAnYW55JyB9LFxyXG4gICAgICAgICAgeyBzcmM6ICdwd2EtNTEyeDUxMi5wbmcnLCAgICAgICAgICBzaXplczogJzUxMng1MTInLCB0eXBlOiAnaW1hZ2UvcG5nJywgcHVycG9zZTogJ2FueScgfSxcclxuICAgICAgICAgIHsgc3JjOiAncHdhLTUxMng1MTItbWFza2FibGUucG5nJywgc2l6ZXM6ICc1MTJ4NTEyJywgdHlwZTogJ2ltYWdlL3BuZycsIHB1cnBvc2U6ICdtYXNrYWJsZScgfSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHNob3J0Y3V0czogW1xyXG4gICAgICAgICAgeyBuYW1lOiAnTmV3IHNhbGUnLCAgICAgICAgc2hvcnRfbmFtZTogJ1NhbGUnLCAgICAgdXJsOiAnL3NhbGVzL25ldycsICAgICAgIGRlc2NyaXB0aW9uOiAnUmVjb3JkIGEgbmV3IHNhbGUnIH0sXHJcbiAgICAgICAgICB7IG5hbWU6ICdQcm9kdWN0cycsICAgICAgICBzaG9ydF9uYW1lOiAnUHJvZHVjdHMnLCB1cmw6ICcvcHJvZHVjdHMnLCAgICAgICAgZGVzY3JpcHRpb246ICdNYW5hZ2UgcHJvZHVjdHMgYW5kIHN0b2NrJyB9LFxyXG4gICAgICAgICAgeyBuYW1lOiAnUHVyY2hhc2UgcmV0dXJuJywgc2hvcnRfbmFtZTogJ1JldHVybnMnLCAgdXJsOiAnL3B1cmNoYXNlLXJldHVybicsIGRlc2NyaXB0aW9uOiAnUmV0dXJuIHByb2R1Y3RzIHRvIGEgc3VwcGxpZXInIH0sXHJcbiAgICAgICAgICB7IG5hbWU6ICdSZXBvcnRzJywgICAgICAgICBzaG9ydF9uYW1lOiAnUmVwb3J0cycsICB1cmw6ICcvcmVwb3J0cycsICAgICAgICAgZGVzY3JpcHRpb246ICdWaWV3IHNhbGVzIHJlcG9ydHMnIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgd29ya2JveDoge1xyXG4gICAgICAgIGNsZWFudXBPdXRkYXRlZENhY2hlczogdHJ1ZSxcclxuICAgICAgICBjbGllbnRzQ2xhaW06IHRydWUsXHJcbiAgICAgICAgc2tpcFdhaXRpbmc6IGZhbHNlLCAvLyB3YWl0IGZvciB1c2VyIHRvIGNvbmZpcm0gXCJSZWxvYWRcIiBiZWZvcmUgYXBwbHlpbmcgYW4gdXBkYXRlXHJcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogJy9pbmRleC5odG1sJyxcclxuICAgICAgICBuYXZpZ2F0ZUZhbGxiYWNrRGVueWxpc3Q6IFsvXlxcL2FwaVxcLy8sIC9eXFwvYXV0aFxcLy9dLFxyXG4gICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxpY28scG5nLHN2ZyxqcGcsanBlZyx3ZWJwLHdvZmYsd29mZjJ9J10sXHJcbiAgICAgICAgbWF4aW11bUZpbGVTaXplVG9DYWNoZUluQnl0ZXM6IDUgKiAxMDI0ICogMTAyNCxcclxuICAgICAgICBydW50aW1lQ2FjaGluZzogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICAvLyBOYXZpZ2F0aW9uIHJlcXVlc3RzOiB0cnkgbmV0d29yayBmaXJzdCwgZmFsbCBiYWNrIHRvIGNhY2hlZCBpbmRleC5odG1sXHJcbiAgICAgICAgICAgIC8vIEltcHJvdmVzIHJlbG9hZCBmcmVzaG5lc3Mgd2hpbGUga2VlcGluZyBhIGZhc3Qgb2ZmbGluZSBmYWxsYmFjay5cclxuICAgICAgICAgICAgdXJsUGF0dGVybjogKHsgcmVxdWVzdCB9KSA9PiByZXF1ZXN0Lm1vZGUgPT09ICduYXZpZ2F0ZScsXHJcbiAgICAgICAgICAgIGhhbmRsZXI6ICdOZXR3b3JrRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnaHRtbC1jYWNoZScsXHJcbiAgICAgICAgICAgICAgbmV0d29ya1RpbWVvdXRTZWNvbmRzOiAzLFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7IHN0YXR1c2VzOiBbMCwgMjAwXSB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgdXJsUGF0dGVybjogL15odHRwczpcXC9cXC9mb250c1xcLmdvb2dsZWFwaXNcXC5jb21cXC8uKi9pLFxyXG4gICAgICAgICAgICBoYW5kbGVyOiAnU3RhbGVXaGlsZVJldmFsaWRhdGUnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7IGNhY2hlTmFtZTogJ2dvb2dsZS1mb250cy1zdHlsZXNoZWV0cycgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9eaHR0cHM6XFwvXFwvZm9udHNcXC5nc3RhdGljXFwuY29tXFwvLiovaSxcclxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnZ29vZ2xlLWZvbnRzLXdlYmZvbnRzJyxcclxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDMwLCBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzNjUgfSxcclxuICAgICAgICAgICAgICBjYWNoZWFibGVSZXNwb25zZTogeyBzdGF0dXNlczogWzAsIDIwMF0gfSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIHVybFBhdHRlcm46ICh7IHJlcXVlc3QgfSkgPT4gcmVxdWVzdC5kZXN0aW5hdGlvbiA9PT0gJ2ltYWdlJyxcclxuICAgICAgICAgICAgaGFuZGxlcjogJ0NhY2hlRmlyc3QnLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgY2FjaGVOYW1lOiAnaW1hZ2VzJyxcclxuICAgICAgICAgICAgICBleHBpcmF0aW9uOiB7IG1heEVudHJpZXM6IDgwLCBtYXhBZ2VTZWNvbmRzOiA2MCAqIDYwICogMjQgKiAzMCB9LFxyXG4gICAgICAgICAgICAgIGNhY2hlYWJsZVJlc3BvbnNlOiB7IHN0YXR1c2VzOiBbMCwgMjAwXSB9LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICBdLFxyXG4gICAgICB9LFxyXG4gICAgICBkZXZPcHRpb25zOiB7XHJcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsIC8vIGRpc2FibGUgZGV2IFNXIGxvZ3MgZHVyaW5nIGRldmVsb3BtZW50OyBlbmFibGUgb25seSB3aGVuIHRlc3RpbmcgUFdBXHJcbiAgICAgICAgdHlwZTogJ21vZHVsZScsXHJcbiAgICAgICAgbmF2aWdhdGVGYWxsYmFjazogJ2luZGV4Lmh0bWwnLFxyXG4gICAgICB9LFxyXG4gICAgfSlcclxuICBdLmZpbHRlcihCb29sZWFuKSxcclxuICByZXNvbHZlOiB7XHJcbiAgICBhbGlhczoge1xyXG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcclxuICAgIH0sXHJcbiAgfSxcclxuICBidWlsZDoge1xyXG4gICAgLy8gUmVkdWNlIHRoZSBjaHVuayBzaXplIHdhcm5pbmcgbGltaXRcclxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTAwMCxcclxuICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAvLyBTZXBhcmF0ZSB2ZW5kb3IgY2h1bmtzIGZvciBiZXR0ZXIgY2FjaGluZ1xyXG4gICAgICAgICAgJ3JlYWN0LXZlbmRvcic6IFsncmVhY3QnLCAncmVhY3QtZG9tJywgJ3JlYWN0LXJvdXRlci1kb20nXSxcclxuICAgICAgICAgICd1aS1jb21wb25lbnRzJzogWydsdWNpZGUtcmVhY3QnXSxcclxuICAgICAgICAgICdzdXBhYmFzZSc6IFsnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXHJcbiAgICAgICAgICAndXRpbHMnOiBbJ2Nsc3gnLCAndGFpbHdpbmQtbWVyZ2UnLCAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5J10sXHJcbiAgICAgICAgICAnZm9ybXMnOiBbJ3JlYWN0LWhvb2stZm9ybScsICdAaG9va2Zvcm0vcmVzb2x2ZXJzJywgJ3pvZCddLFxyXG4gICAgICAgICAgJ2NoYXJ0cyc6IFsncmVjaGFydHMnXSxcclxuICAgICAgICAgICdkYXRlLXV0aWxzJzogWydkYXRlLWZucyddLFxyXG4gICAgICAgICAgJ3ZpcnR1YWxpemF0aW9uJzogWydyZWFjdC13aW5kb3cnLCAncmVhY3QtdmlydHVhbGl6ZWQtYXV0by1zaXplciddLFxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufSkpOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBa2EsU0FBUyxvQkFBb0I7QUFDL2IsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixTQUFTLHVCQUF1QjtBQUNoQyxTQUFTLGVBQWU7QUFKeEIsSUFBTSxtQ0FBbUM7QUFPekMsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE9BQU87QUFBQSxFQUN6QyxNQUFNO0FBQUE7QUFBQSxFQUNOLFFBQVE7QUFBQSxFQUNSLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixTQUFTLGlCQUFpQixnQkFBZ0I7QUFBQSxJQUMxQyxRQUFRO0FBQUEsTUFDTixjQUFjO0FBQUEsTUFDZCxnQkFBZ0I7QUFBQTtBQUFBLE1BQ2hCLGVB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
