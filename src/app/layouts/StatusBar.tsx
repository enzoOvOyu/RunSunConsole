import { useConnection } from "../../stores/connection";
import { CreditCard, Activity, Layers, MapPin } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useRegion } from "../../stores/region";
import { useData } from "../../features/shared/hooks";
import { EP, query } from "../../lib/api-client";
import { t } from "../../i18n";
import { money } from "../../lib/money";
import styles from "./layout.module.css";
export function StatusBar() {
  const mode = useConnection((s) => s.mode);
  const { pathname } = useLocation();
  const selected = useRegion((s) => s.region);
  const regional =
    /^\/(resources|deployment)\//.test(pathname) ||
    [
      "/ops/quotas",
      "/ops/cost",
      "/ops/tickets",
      "/workbench/notebooks",
      "/workbench/scaling",
      "/data/storage",
    ].includes(pathname);
  const region = regional ? selected : "";
  const data = useData<{ balance: number; month: number; running: number }>(
    ["summary", region],
    EP.summary + query({ region }),
    { poll: true },
  );
  return (
    <div className={styles.statusbar} aria-label={t("common.connection")}>
      <div className={styles.statusGroup}>
        <span>
          <span
            className="status-dot"
            style={{
              background: data.isError ? "var(--rs-danger)" : undefined,
            }}
          />
          {data.isError
            ? t("common.offline")
            : t(mode === "websocket" ? "common.websocket" : "common.polling")}
        </span>
        <span className={styles.optional}>
          <MapPin size={12} />
          {region ? t(`common.${region}`) : t("common.allRegions")}
        </span>
        <span>
          <CreditCard size={12} />
          {t("common.balance")}{" "}
          <strong>{data.data ? money(data.data.balance) : "—"}</strong>
        </span>
        <span className={styles.optional}>
          <Activity size={12} />
          {t("common.mtd")} {data.data ? money(data.data.month) : "—"}
        </span>
        <span className={styles.optional}>
          <Layers size={12} />
          {t("common.running")} {data.data?.running ?? "—"}
        </span>
      </div>
      <small className={styles.optional}>USD</small>
    </div>
  );
}
