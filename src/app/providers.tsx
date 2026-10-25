import { TooltipProvider } from "../components/ui/tooltip";
import { ConfirmAction } from "../components/ui/ConfirmAction";
import { Realtime } from "./Realtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});
function allowUuidOnHttp() {
  if (typeof (crypto as Partial<Crypto>).randomUUID === "function") return;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      );
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    },
  });
}
export async function initialize() {
  allowUuidOnHttp();
  if (import.meta.env.VITE_ENABLE_MOCK !== "false") {
    const { startMock } = await import("../mocks/browser");
    await startMock();
  } else if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const mockRegistrations = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some(
        (worker) => worker && new URL(worker.scriptURL).pathname === "/mockServiceWorker.js",
      ),
    );
    await Promise.all(mockRegistrations.map((registration) => registration.unregister()));
    if (mockRegistrations.length && navigator.serviceWorker.controller &&
      new URL(navigator.serviceWorker.controller.scriptURL).pathname === "/mockServiceWorker.js") {
      window.location.reload();
      await new Promise<void>(() => {});
    }
  }
}
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Realtime />
        <ConfirmAction />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
