import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_DEV_BACKEND || 'https://www.remediumlabs.in';
  const care = env.VITE_DEV_CARE || 'https://care.e-remedium.in';
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5184,
      strictPort: true,
      proxy: {
        '/api': { target: backend, changeOrigin: true, secure: true },
        '/files': { target: backend, changeOrigin: true, secure: true },
        '/rfms-api': { target: backend, changeOrigin: true, secure: true },
        '/care-api': { target: care, changeOrigin: true, secure: true },
        '/aes-api': { target: care, changeOrigin: true, secure: true },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5184,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
