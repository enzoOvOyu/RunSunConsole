import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection } from "../stores/connection";
import { invalidateData } from "../lib/query-cache";
export function Realtime() {
  const client = useQueryClient();
  useEffect(() => {
    const invalidate = (nonPollingOnly = false) =>
      invalidateData(client, { delay: 150, nonPollingOnly });
    const endpoint = import.meta.env.VITE_WS_URL;
    if (!endpoint && import.meta.env.VITE_ENABLE_MOCK === "false") {
      const stream = new EventSource("/api/events/stream");
      stream.onopen = () => useConnection.getState().setMode("stream");
      stream.addEventListener("change", () => {
        useConnection.getState().setMode("stream");
        invalidate(true);
      });
      stream.onerror = () => useConnection.getState().setMode("polling");
      const fallback = setInterval(
        () => {
          if (useConnection.getState().mode !== "stream")
            invalidate(true);
        },
        Math.max(
          30_000,
          Number(import.meta.env.VITE_POLL_INTERVAL_MS || 10_000),
        ),
      );
      return () => {
        clearInterval(fallback);
        stream.close();
      };
    }
    if (!endpoint) return;
    let ws: WebSocket;
    let lastMessage = 0;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      useConnection.getState().setMode("polling");
      return;
    }
    ws.onopen = () => {
      lastMessage = Date.now();
      useConnection.getState().setMode("websocket");
    };
    ws.onmessage = () => {
      lastMessage = Date.now();
      useConnection.getState().setMode("websocket");
      invalidate(true);
    };
    ws.onerror = () => useConnection.getState().setMode("polling");
    ws.onclose = () => useConnection.getState().setMode("polling");
    const heartbeat = setInterval(() => {
      if (Date.now() - lastMessage > 30000)
        useConnection.getState().setMode("polling");
    }, 5000);
    return () => {
      clearInterval(heartbeat);
      ws.close();
    };
  }, [client]);
  return null;
}
