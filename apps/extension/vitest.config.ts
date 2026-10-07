import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Default environment is node. Individual test files that need a DOM opt in with
// a `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
