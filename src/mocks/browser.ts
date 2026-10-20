import { setupWorker } from "msw/browser";
import { handlers, handleMockRequest } from "./handlers";
import { db } from "./lib/database";
import { assertConsistency } from "./lib/consistency";
function startFetchMock() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/")
    )
      return handleMockRequest(new Request(input, init));
    return nativeFetch(input, init);
  };
}
export async function startMock() {
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_CONSISTENCY_CHECK !== "false"
  )
    assertConsistency(db);
  if (!("serviceWorker" in navigator)) {
    startFetchMock();
    return;
  }
  const worker = setupWorker(...handlers);
  try {
    await worker.start({ onUnhandledRequest: "bypass", quiet: true });
  } catch {
    startFetchMock();
  }
}
