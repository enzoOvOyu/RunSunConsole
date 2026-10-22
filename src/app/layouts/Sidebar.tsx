import { NavLink } from "react-router-dom";
import { memo, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAuth } from "../../stores/auth";
import { useNav } from "../../stores/nav";
import { useLocale } from "../../stores/locale";
import { buildGroups } from "./navModel";
import { t } from "../../i18n";
import styles from "./layout.module.css";
export const Sidebar = memo(function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const role = useAuth((s) => s.role);
  useLocale((state) => state.locale);
  const collapsedGroups = useNav((state) => state.collapsedGroups);
  const toggle = useNav((state) => state.toggle);
  const groups = useMemo(() => buildGroups(role), [role]);
  return (
    <>
      <aside
        className={`${styles.sidebar} ${open ? styles.open : ""}`}
        aria-label={t("nav.resources")}
      >
        <NavLink className={styles.brand} to="/overview" onClick={onClose}>
          <img src="/favicon.ico" alt="" />
          <div>
            <strong>RunSun</strong>
            <div>
              <small>GPU CLOUD</small>
            </div>
          </div>
        </NavLink>
        <nav className={styles.nav}>
          {groups.map((group) => {
            const expanded = !collapsedGroups.includes(group.id);
            const Icon = group.icon;
            return (
              <div className={styles.navGroup} key={group.id}>
                {group.direct ? (
                  <Button asChild variant="ghost" className={styles.navLink}>
                    <NavLink
                      to={group.items[0].path}
                      className={({ isActive, isPending }) =>
                        isActive ? styles.active : isPending ? styles.pending : ""
                      }
                      onClick={onClose}
                    >
                      <Icon size={17} />
                      {group.label()}
                    </NavLink>
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      className={styles.groupButton}
                      aria-expanded={expanded}
                      onClick={() => toggle(group.id)}
                    >
                      <Icon size={16} />
                      {group.label()}
                      <ChevronDown
                        size={13}
                        style={{
                          transform: expanded ? "rotate(180deg)" : undefined,
                        }}
                      />
                    </Button>
                    {expanded && (
                      <div className={styles.subItems}>
                        {group.items.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <Button
                              key={item.path}
                              asChild
                              variant="ghost"
                              className={styles.navLink}
                            >
                              <NavLink
                                to={item.path}
                                onClick={onClose}
                                className={({ isActive, isPending }) =>
                                  isActive ? styles.active : isPending ? styles.pending : ""
                                }
                              >
                                <ItemIcon
                                  size={16}
                                  strokeWidth={1.75}
                                  aria-hidden="true"
                                  style={{ color: item.color }}
                                />
                                {item.label()}
                              </NavLink>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </nav>
        <div className={styles.sideFoot}>
          <div className="row">
            <span className="status-dot" />
            RunSun Cloud
          </div>
          <small>© {new Date().getFullYear()} RunSun</small>
        </div>
      </aside>
      {open && (
        <button
          className="overlay"
          style={{ zIndex: 40, border: 0 }}
          aria-label={t("common.close")}
          onClick={onClose}
        />
      )}
    </>
  );
});
