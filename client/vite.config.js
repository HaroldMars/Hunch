import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const api = process.env.VITE_DEV_API || 'http://localhost:5000';
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/' : '/',
  // dedupe: shared/ imports React; always resolve it from this app's own node_modules (needed on Vercel).
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') }, dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': api,
      '/uploads': api,
      '/socket.io': { target: api, ws: true },
    },
  },
});
