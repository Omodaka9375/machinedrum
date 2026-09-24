// Vite + PWA configuration. `npm run dev` / `build` / `preview`.
//
// The app ships as plain ES modules with no framework, so this file only configures the PWA:
// web app manifest, service worker precache, and icons. The hand-written serve.mjs stays useful
// for a no-install static server, but `npm run preview` is what serves the built output.

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
    // One CSS bundle and one JS chunk is right for an app this size; per-page splitting would
    // just add round trips for a single-screen instrument.
    assetsInlineLimit: 0,
    // modulePreload belongs here, not at the top level of the config.
    modulePreload: { polyfill: false },
  },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Files referenced by the manifest that are not emitted by Rollup.
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],

      manifest: {
        id: '/',
        scope: '/',
        start_url: '/',
        name: 'MACHINEDRUM — Drum Study',
        short_name: 'MACHINEDRUM',
        description:
          'Sixteen-voice digital drum synthesizer and step sequencer. Synthesised in real time, runs offline.',
        lang: 'en',
        dir: 'ltr',
        categories: ['music', 'utilities'],

        // No display_override: window-controls-overlay needs titlebar-area handling the panel
        // CSS does not have, so plain standalone is the honest choice.
        display: 'standalone',
        orientation: 'any',

        // Matches the --dark token in style.css.
        background_color: '#202526',
        theme_color: '#222729',

        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],

        // No shortcuts: the app does not handle query params, so shortcut URLs would promise
        // behaviour that does not exist.
      },

      workbox: {
        // Everything is local and immutable-per-build, so precaching the whole output is the
        // correct offline strategy: no runtime routing, no network passes.
        globPatterns: ['**/*.{css,html,js,svg,png,ttf,woff2,webmanifest}'],
        // index.html is already precached; a navigateFallback would fight the built asset graph.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },

      // Off by default: a dev-mode service worker caches the module graph and makes live edits
      // confusing. Opt in with `npm run dev -- --sw` if you need to debug the worker itself.
      devOptions: { enabled: false },
    }),
  ],

  server: {
    port: 5173,
    strictPort: false,
  },

  preview: {
    // 4173 is serve.mjs's port (the no-install server). Keeping preview off it means both
    // can run side by side instead of fighting over the port.
    port: 4174,
    // Vite binds ::1 only when given no host, and 127.0.0.1 connections then get refused.
    host: true, // dual-stack: both localhost stacks answer
  },
});
