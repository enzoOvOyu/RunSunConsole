import { create } from "zustand";
export const useConnection = create<{
  mode: "polling" | "websocket" | "offline";
  setMode: (mode: "polling" | "websocket" | "offline") => void;
}>((set) => ({ mode: "polling", setMode: (mode) => set({ mode }) }));
