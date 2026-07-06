import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Node enrollment API. Target is configurable
// so it works on the host (localhost:3001) and in Docker Compose (http://api:3001).
const apiTarget = process.env.API_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
