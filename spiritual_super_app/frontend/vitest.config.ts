import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * No @vitejs/plugin-react here on purpose. It pulls its own copy of vite, and the two sets of vite
 * types then conflict badly enough to break both `tsc --noEmit` and `next build`, which typechecks
 * this file. The esbuild option below is all the JSX handling these tests need; the plugin's extra
 * work (fast refresh) is irrelevant to a test run.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // Next.js sets "jsx": "preserve" in tsconfig, which esbuild reads and then falls back to the
  // classic runtime, so JSX compiled to React.createElement and every render failed with
  // "React is not defined". Ask for the automatic runtime explicitly.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
