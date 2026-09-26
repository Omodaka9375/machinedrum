// Vite + PWA configuration. `npm run dev` / `build` / `preview`.
//
// The app ships as plain ES modules with no framework, so this file only configures the PWA:
// web app manifest, service worker precache, and icons. `npm run preview` serves the built
// output; `npm run dev` serves the sources.

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves a project site from https://<user>.github.io/<repo>/, so all URLs must
  // resolve relative to wherever the build lands. Relative base means the same dist/ works at
  // any subpath — Pages, a local subdirectory, or the domain root.
  base: './',

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

      manifestFilename: 'manifest.json',
      manifest: {
        // Relative so the manifest stays valid under the repo subpath on GitHub Pages. Vite
        // rewrites these against `base` when it emits manifest.webmanifest.
        id: './',
        scope: './',
        start_url: './',
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
        globPatterns: ['**/*.{css,html,js,svg,png,ttf,woff2,json}'],
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
    // 4173 is left free for anything else the developer may run; preview claims 4174.
    port: 4174,
    // Vite binds ::1 only when given no host, and 127.0.0.1 connections then get refused.
    host: true, // dual-stack: both localhost stacks answer
  },
});
