import { useCallback, useLayoutEffect, useState } from "react";
import { Outlet, useLocation, Navigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "../../components/command/CommandPalette";
import { Toasts } from "../../components/ui";
import { useLocale } from "../../stores/locale";
import { useTheme } from "../../stores/theme";
import { useAuth } from "../../stores/auth";
import { canSeePath } from "../../lib/rbac";
import styles from "./layout.module.css";
export default function ConsoleLayout() {
  const [menu, setMenu] = useState(false);
  const [command, setCommand] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const locale = useLocale((s) => s.locale);
  const theme = useTheme((s) => s.theme);
  const role = useAuth((s) => s.role);
  const location = useLocation();
  useLayoutEffect(() => {
    if (document.documentElement.lang !== locale)
      document.documentElement.lang = locale;
  }, [locale]);
  useLayoutEffect(() => {
    if (document.documentElement.dataset.theme !== theme)
      document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className={styles.shell}>
      <Sidebar open={menu} onClose={closeMenu} />
      <div className={styles.main}>
        <Topbar
          onSearch={() => setCommand(true)}
          onMenu={() => setMenu(true)}
        />
        {import.meta.env.VITE_FEATURE_STATUS_BAR !== "false" && <StatusBar />}
        <main className="page">
          {canSeePath(role, location.pathname) ? (
            <Outlet />
          ) : (
            <Navigate to="/overview" replace />
          )}
        </main>
      </div>
      <CommandPalette open={command} onChange={setCommand} />
      <Toasts />
    </div>
  );
}
