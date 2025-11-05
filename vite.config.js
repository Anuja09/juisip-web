import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** @type {import('vite').UserConfig} */
export default defineConfig({
  // Load the official React plugin to handle JSX and React-specific features (like Fast Refresh)
  plugins: [react(), tailwindcss()],

  // Configure the server for development
  server: {
    // Automatically open the browser when running 'npm run dev'
    open: true,
    // You can specify the port if 5173 is already in use (optional)
    // port: 3000,
  },

  // Configure the build output (optional for simple apps)
  build: {
    // Generate source maps for easier debugging in production
    sourcemap: true,
  }
});
