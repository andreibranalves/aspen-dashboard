import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'static', // assets estáticos separados do output de build
  build: {
    outDir: 'public',
    emptyOutDir: false, // preserva arquivos não-gerados (dashboard-old.html etc)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor';
          }
          if (/node_modules\/(tailwind-merge|clsx|class-variance-authority)\//.test(id)) {
            return 'ui-vendor';
          }
          if (/node_modules\/lucide-react\//.test(id)) {
            return 'icons';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
