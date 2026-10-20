import { create } from "zustand";
export const useConnection = create<{
  mode: "polling" | "websocket" | "stream" | "offline";
  setMode: (mode: "polling" | "websocket" | "stream" | "offline") => void;
}>((set) => ({ mode: "polling", setMode: (mode) => set({ mode }) }));
