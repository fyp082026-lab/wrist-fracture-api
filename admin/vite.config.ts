import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the FastAPI server at /admin. In `npm run dev` the API calls are
// proxied to the live server, so the site can be developed locally.
const API_ORIGIN = 'https://wristfracture.duckdns.org';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin/api': { target: API_ORIGIN, changeOrigin: true },
      '/health': { target: API_ORIGIN, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
