import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_DEV_BACKEND || 'https://www.remediumlabs.in';
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5182,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true, secure: true },
        '/files': { target: backend, changeOrigin: true, secure: true },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5182,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
