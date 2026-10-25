import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/ui";
import { t } from "../../i18n";

export function ListFilters({ children, advanced, activeCount = 0, onReset, actions }: {
  children: ReactNode;
  advanced?: ReactNode;
  activeCount?: number;
  onReset?: () => void;
  actions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="list-filters">
      <div className="toolbar list-filter-primary">
        {children}
        {advanced && <Button aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          {t("common.moreFilters")}
          {activeCount > 0 && <span className="filter-count" aria-label={t("common.activeFilters", { count: activeCount })}>{activeCount}</span>}
        </Button>}
        {actions}
        {activeCount > 0 && onReset && <Button variant="ghost" onClick={onReset}>{t("common.reset")}</Button>}
      </div>
      {advanced && <div id={id} hidden={!expanded} className="toolbar list-filter-advanced">{advanced}</div>}
    </div>
  );
}
