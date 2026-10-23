import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { REGIONS } from "../../types/domain";
import { useRegion } from "../../stores/region";
import { t } from "../../i18n";
export function RegionFilter({ org = false }: { org?: boolean }) {
  const { region, setRegion } = useRegion();
  const [params, setParams] = useSearchParams();
  const selected = params.get("region");
  useEffect(() => {
    if (!org && REGIONS.includes(selected as typeof region))
      setRegion(selected as typeof region);
  }, [selected, setRegion, org]);
  return (
    <select
      aria-label={t("common.region")}
      value={region}
      disabled={org}
      title={org ? t("common.orgScope") : undefined}
      onChange={(e) => {
        setRegion(e.target.value as typeof region);
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("region", e.target.value);
            next.delete("project_id");
            next.delete("drawer");
            return next;
          },
          { replace: true },
        );
      }}
    >
      {REGIONS.map((r) => (
        <option key={r} value={r}>
          {t("common." + r)}
        </option>
      ))}
    </select>
  );
}
