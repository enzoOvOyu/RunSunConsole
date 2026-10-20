import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      ...(env.VITE_ENABLE_MOCK === "false"
        ? {
            proxy: {
              "/api": { target: "http://api:8080", changeOrigin: true },
            },
          }
        : {}),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules")) {
              if (/msw|@mswjs/.test(id)) return "mock-worker";
              if (/recharts|d3-|victory/.test(id)) return "charts";
              if (/react-router/.test(id)) return "router";
              if (/react-dom|\/react\//.test(id)) return "react";
            }
          },
        },
      },
    },
  };
});
