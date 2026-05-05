import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.MISSION_CONTROL_PORT ?? 5050);
const CLIENT_PORT = Number(process.env.MISSION_CONTROL_CLIENT_PORT ?? 5051);

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
