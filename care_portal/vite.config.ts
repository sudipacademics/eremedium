import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_DEV_BACKEND || 'https://www.remediumlabs.in';
  const careApi = env.VITE_DEV_CARE_API || 'http://127.0.0.1:8095';
  return {
    base: env.VITE_BASE || '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5183,
      strictPort: true,
      proxy: {
        '/care-api': { target: careApi, changeOrigin: true },
        '/aes-api': { target: env.VITE_DEV_AES_API || 'http://127.0.0.1:8096', changeOrigin: true, rewrite: (p) => p.replace(/^\/aes-api/, '/care-api') },
        '/api': { target: backend, changeOrigin: true, secure: true },
        '/files': { target: backend, changeOrigin: true, secure: true },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5183,
      strictPort: true,
    },
    build: {
      outDir: env.VITE_OUT_DIR || 'dist',
      emptyOutDir: true,
    },
  };
});
