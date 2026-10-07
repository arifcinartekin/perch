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
        'A privacy-first, local-only RSS reader. No account, no cloud, no telemetry, no broad site access.',
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
      // Note: `action` (title/popup) and `options_ui` are derived by WXT from the
      // popup/options entrypoints — see their <title> and <meta> tags.
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'perch@perch.rss',
                // 128 = first Firefox with scripting.executeScript({ func }).
                strict_min_version: '128.0',
                // Perch collects and transmits no user data at all.
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
    };
  },
});
