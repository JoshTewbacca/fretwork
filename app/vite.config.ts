import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { alphaTab } from '@coderline/alphatab-vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    preact(),
    alphaTab(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is done explicitly by src/pwa/register.ts (initPwa),
      // which the app wires in during startup - don't also auto-inject a
      // <script> that would register the SW a second time.
      injectRegister: false,
      manifest: {
        name: 'Fretwork',
        short_name: 'Fretwork',
        description: 'Guitar tab player and practice tool.',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        background_color: '#0e0f12',
        theme_color: '#0e0f12',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // The alphaTab vite plugin copies notation font files (woff/woff2/otf/eot)
        // to public/font/ and the soundfont (sf3, ~1 MB) to public/soundfont/ at
        // build time; all of it must be precached so the player boots and plays
        // fully offline (see ADR-003).
        globPatterns: [
          '**/*.{js,css,html,svg,png,woff,woff2,otf,eot,sf3,sf2}',
        ],
        // Precache only what modern iOS Safari actually loads: woff2 + sf3.
        // The legacy font formats and the sf2 would add ~4.6 MB for nothing.
        globIgnores: [
          '**/sonivox.sf2',
          '**/font/Bravura.eot',
          '**/font/Bravura.otf',
          '**/font/Bravura.svg',
          '**/font/Bravura.woff',
        ],
        // Default workbox limit (2 MB) is too small for the soundfont; raise it.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
    }),
  ],
})
