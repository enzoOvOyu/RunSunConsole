import { create } from "zustand";
function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("rs.nav.collapsed") || "[]");
    return Array.isArray(value)
      ? value.filter((x: unknown): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function readCompact(): boolean {
  try {
    return localStorage.getItem("rs.nav.compact") === "true";
  } catch {
    return false;
  }
}
export const useNav = create<{
  compact: boolean;
  toggleCompact: () => void;
  collapsedGroups: string[];
  toggle: (id: string) => void;
}>((set, get) => ({
  compact: readCompact(),
  toggleCompact: () => {
    const compact = !get().compact;
    try {
      localStorage.setItem("rs.nav.compact", String(compact));
    } catch {
      // Keep navigation usable when browser storage is unavailable.
    }
    set({ compact });
  },
  collapsedGroups: read(),
  toggle: (id) => {
    const collapsedGroups = get().collapsedGroups.includes(id)
      ? get().collapsedGroups.filter((x) => x !== id)
      : [...get().collapsedGroups, id];
    localStorage.setItem("rs.nav.collapsed", JSON.stringify(collapsedGroups));
    set({ collapsedGroups });
  },
}));
