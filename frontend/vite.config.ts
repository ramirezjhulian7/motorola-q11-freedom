import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { mockRouter } from './demo/mock-router.ts'

// Router IP for the dev proxy (override with the VITE_ROUTER env var).
const ROUTER = process.env.VITE_ROUTER || 'http://192.168.50.1'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Demo mode (`npm run demo` or VITE_DEMO=1): fictional router, no proxy.
  const demo = mode === 'demo' || process.env.VITE_DEMO === '1'
  // Static demo for GitHub Pages (`npm run build:pages`): fictional router in the browser.
  const pages = mode === 'pages'
  return {
    // Served from /www/app/ on the router (uhttpd has no SPA rewrite).
    base: pages ? '/motorola-q11-freedom/' : '/app/',
    define: {
      'import.meta.env.VITE_STATIC_DEMO': JSON.stringify(pages ? '1' : '0'),
    },
    plugins: [
      react(),
      demo && mockRouter(),
      // The PWA scope is /app/ on the router; the Pages demo does not need it.
      !pages && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'Q11 Freedom',
          short_name: 'Q11 Freedom',
          description: 'Local control panel for a Motorola Q11 mesh network',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          scope: '/app/',
          start_url: '/app/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // never cache the API; only the app shell
          navigateFallbackDenylist: [/^\/ubus/, /^\/cgi-bin/],
        },
      }),
    ],
    // Keep the bundle small: the router only has ~15MB free.
    build: {
      target: 'es2020',
      cssCodeSplit: false,
      reportCompressedSize: true,
    },
    server: {
      proxy: demo ? undefined : {
        '/ubus': { target: ROUTER, changeOrigin: true },
        '/cgi-bin': { target: ROUTER, changeOrigin: true },
      },
    },
  }
})
