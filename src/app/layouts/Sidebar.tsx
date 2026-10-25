import { NavLink, useLocation } from "react-router-dom";
import { memo, useMemo, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  const compact = useNav((state) => state.compact);
  const toggleCompact = useNav((state) => state.toggleCompact);
  const role = useAuth((s) => s.role);
  const location = useLocation();
  const [closedActiveGroup, setClosedActiveGroup] = useState<{
    id: string;
    routeKey: string;
    role: string;
  } | null>(null);
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
          <div className={styles.brandText}>
            <strong>RunSun</strong>
            <div>
              <small>GPU CLOUD</small>
            </div>
          </div>
        </NavLink>
        <nav className={styles.nav}>
          {groups.map((group) => {
            const activeGroup = group.items.some(
              (item) =>
                location.pathname === item.path ||
                location.pathname.startsWith(`${item.path}/`),
            );
            const manuallyClosed =
              closedActiveGroup?.id === group.id &&
              closedActiveGroup.routeKey === location.key &&
              closedActiveGroup.role === role;
            const expanded = activeGroup
              ? !manuallyClosed
              : !collapsedGroups.includes(group.id);
            const Icon = group.icon;
            return (
              <div className={styles.navGroup} key={group.id}>
                {group.direct ? (
                  <NavLink
                    to={group.items[0].path}
                    aria-label={group.label()}
                    title={group.label()}
                    className={({ isActive, isPending }) =>
                      `${styles.navLink} ${isActive ? styles.active : isPending ? styles.pending : ""}`
                    }
                    onClick={onClose}
                  >
                    <Icon size={17} />
                    <span className={styles.navLabel}>{group.label()}</span>
                  </NavLink>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      className={styles.groupButton}
                      aria-label={group.label()}
                      title={group.label()}
                      aria-expanded={expanded}
                      onClick={() => {
                        if (!activeGroup) {
                          toggle(group.id);
                        } else if (expanded) {
                          setClosedActiveGroup({
                            id: group.id,
                            routeKey: location.key,
                            role,
                          });
                          if (!collapsedGroups.includes(group.id)) {
                            toggle(group.id);
                          }
                        } else {
                          setClosedActiveGroup(null);
                          if (collapsedGroups.includes(group.id)) {
                            toggle(group.id);
                          }
                        }
                      }}
                    >
                      <Icon size={16} />
                      <span className={styles.navLabel}>{group.label()}</span>
                      <ChevronDown
                        className={styles.groupChevron}
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
                            <NavLink
                              key={item.path}
                              to={item.path}
                              aria-label={item.label()}
                              title={item.label()}
                              onClick={onClose}
                              className={({ isActive, isPending }) =>
                                `${styles.navLink} ${isActive ? styles.active : isPending ? styles.pending : ""}`
                              }
                            >
                              <ItemIcon
                                size={16}
                                strokeWidth={1.75}
                                aria-hidden="true"
                                style={{ color: item.color }}
                              />
                              <span className={styles.navLabel}>{item.label()}</span>
                            </NavLink>
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
        <Button
          variant="ghost"
          className={styles.sidebarToggle}
          onClick={toggleCompact}
          aria-label={t(compact ? "nav.expandSidebar" : "nav.collapseSidebar")}
          title={t(compact ? "nav.expandSidebar" : "nav.collapseSidebar")}
        >
          {compact ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className={styles.navLabel}>{t("nav.collapseSidebar")}</span>
        </Button>
        <div className={styles.sideFoot}>
          <div className="row">
            <span className="status-dot" />
            RunSun Cloud
            <span className={styles.roleBadge}>{t(`common.${role}`)}</span>
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
