import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection } from "../stores/connection";
export function Realtime() {
  const client = useQueryClient();
  useEffect(() => {
    const endpoint = import.meta.env.VITE_WS_URL;
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
      void client.invalidateQueries();
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
