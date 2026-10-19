import { create } from "zustand";
const saved =
  typeof localStorage === "undefined" ? null : localStorage.getItem("rs.theme");
export const useTheme = create<{ theme: "light" | "dark"; toggle: () => void }>(
  (set, get) => ({
    theme:
      saved === "dark"
        ? "dark"
        : import.meta.env.VITE_THEME_DEFAULT === "dark"
          ? "dark"
          : "light",
    toggle: () => {
      const theme = get().theme === "light" ? "dark" : "light";
      localStorage.setItem("rs.theme", theme);
      document.documentElement.dataset.theme = theme;
      set({ theme });
    },
  }),
);
