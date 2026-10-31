import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env['KAREN_SERVER'] ?? 'http://127.0.0.1:7331';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/ws': { target, ws: true },
    },
  },
});
