import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Perch — cross-browser, local-only RSS reader.
// The manifest is intentionally minimal: NO host permissions are requested at
// install time, so users never see the "read and change all your data on all
// websites" warning. Broader access is requested at runtime, incrementally, and
// only with a clear explanation. See README "Permissions" for the full rationale.
export default defineConfig({
  srcDir: 'src',
  // Build into the repo root's .output/ (where it lived before the monorepo move):
  // Chromium derives an unpacked extension's id from its folder, so moving the
  // folder would give it a new id and orphan the user's local data.
  outDir: '../../.output',
  modules: ['@wxt-dev/module-react'],
  // Manifest V3 on every target, including Firefox (Gecko 128+).
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    return {
      name: 'Perch',
      description:
        'A calm, private feed reader. Local by default, no telemetry, no broad site access; sync with an end-to-end encrypted chain if you want.',
      // Install-time permissions only. None of these grant standing access to
      // page content across the web.
      permissions: [
        'storage', // feed list, categories, settings
        'activeTab', // read the current tab's <head> only when the user opens the popup
        'scripting', // inject the one-shot feed-discovery reader into the active tab
        'alarms', // periodic background feed refresh
      ],
      // Optional, runtime-requested host access (MV3 key, supported by Chromium
      // and Firefox 128+):
      // - "*://*/*" is only requested if the user turns on "Auto-discover feeds
      //   on every site" in Settings.
      // - Per-origin patterns (e.g. "https://example.com/*") are requested when
      //   the user adds a feed or opens full-text for a new domain.
      optional_host_permissions: ['*://*/*'],
      // Signing in to a Perch Server stretches the password with Argon2id, which
      // runs as WebAssembly. This allows compiling Perch's own bundled WASM only;
      // remote code is still blocked.
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
      },
      // Note: `action` (title/popup) and `options_ui` are derived by WXT from the
      // popup/options entrypoints — see their <title> and <meta> tags.
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'perch@perch.rss',
                // 128 = first Firefox with scripting.executeScript({ func }).
                strict_min_version: '128.0',
                // Nothing is sent unless you turn something on. Then, by
                // feature (asked for at that moment, see DATA_FOR in
                // lib/permissions/host.ts): a sync chain sends your library,
                // end-to-end encrypted, to the relay; a Perch Server account
                // sends it to that server; a Perch account (for sharing)
                // sends your username and the notes you share.
                data_collection_permissions: {
                  required: ['none'],
                  optional: [
                    'authenticationInfo',
                    'personallyIdentifyingInfo',
                    'browsingActivity',
                    'websiteContent',
                  ],
                },
              },
            },
          }
        : {}),
    };
  },
});
