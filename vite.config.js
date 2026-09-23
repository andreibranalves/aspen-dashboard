import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN?.trim();

export default defineConfig({
  // Vite não usa DOTENV_CONFIG_PATH: desligar seu loader também no E2E.
  envDir: process.env.NODE_ENV === 'test' ? false : undefined,
  plugins: [
    react(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            authToken: sentryAuthToken,
            org: 'aspen-estamparia',
            project: 'aspen-web',
            telemetry: false,
            release: {
              name: process.env.VERCEL_GIT_COMMIT_SHA,
              setCommits: false,
            },
            sourcemaps: {
              filesToDeleteAfterUpload: ['./public/assets/**/*.map'],
            },
            errorHandler(error) {
              console.warn(`[sentry] source map upload failed (${error.name})`);
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'static', // assets estáticos separados do output de build
  build: {
    outDir: 'public',
    emptyOutDir: false, // preserva arquivos não-gerados (dashboard-old.html etc)
    sourcemap: sentryAuthToken ? 'hidden' : false,
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
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
