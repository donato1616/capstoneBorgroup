import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `${process.env.VITE_API_BASE || 'http://localhost:5050'}`,  // Dynamically use VITE_API_BASE or fall back to localhost for local dev
        changeOrigin: true,
        secure: false, // disables SSL verification for local dev
      },
    },
  },
  preview: {
    allowedHosts: ['.railway.app'], // Allow all Railway subdomains
  },
});