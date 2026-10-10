import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API comes from a Perch Server on :8080
// (`npm run dev:server`); in production the server serves this build.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The web reader on a hub runs the extension's library code (apps/extension/
// src/lib) in the page, with a small stand-in for the WebExtension API.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: 'wxt/browser', replacement: here('./src/local/browser.ts') },
      { find: /^@\//, replacement: `${here('../extension/src')}/` },
    ],
  },
  define: { 'import.meta.env.BROWSER': JSON.stringify('web') },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
