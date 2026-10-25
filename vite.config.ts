import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
const rootDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    cacheDir: env.VITE_ENABLE_MOCK === "false" ? "node_modules/.vite-api" : "node_modules/.vite-mock",
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(rootDir, "src") } },
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
            if (id.includes("/src/i18n/locales/")) return "locales";
            if (!id.includes("node_modules")) return;
            if (/msw|@mswjs/.test(id)) return "mock-worker";
            if (/recharts|d3-|victory/.test(id)) return "charts";
            if (/@tanstack\/react-query|@tanstack\/query-core/.test(id))
              return "query";
            if (/react-router/.test(id)) return "router";
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
            if (
              /lucide-react|cmdk|radix-ui|@radix-ui|tailwind-merge|clsx|class-variance-authority/.test(
                id,
              )
            )
              return "ui";
          },
        },
      },
    },
  };
});
