import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true }, build: { rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules')) { if (/msw|@mswjs/.test(id)) return 'mock-worker'; if (/recharts|d3-|victory/.test(id)) return 'charts'; if (/react-router/.test(id)) return 'router'; if (/react-dom|\/react\//.test(id)) return 'react'; } } } } } });
