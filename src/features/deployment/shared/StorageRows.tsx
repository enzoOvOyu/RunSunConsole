import { Button, Field, Panel } from "../../../components/ui";
import { Link } from "react-router-dom";
import { t } from "../../../i18n";
import type {
  StorageRequest,
} from "../../../types/storage";
import { useSpec } from "./fields";
import { clientUuid } from "../../../lib/uuid";
import { useStorageEstimate } from "../../shared/useStorageEstimate";
import { money } from "../../../lib/money";
import { useStorageProducts } from "../../shared/useStorageProducts";

export function StorageRows() {
  const { spec, update } = useSpec();
  const rows = spec.storageSelections || [];
  const prices = useStorageEstimate(rows);
  const catalog = useStorageProducts();
  const products = (catalog.data || []).filter((product) => product.kind === "block");
  const change = (key: string, patch: Partial<StorageRequest>) =>
    update({
      storageSelections: rows.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    });
  return (
    <Panel
      title={t("storage.additional")}
      action={
        <Button
          disabled={rows.length >= 8 || !products.length}
          onClick={() => {
            const product = products[0];
            if (!product) return;
            let suffix = 1;
            while (rows.some((row) => row.name === `data-${suffix}`))
              suffix++;
            update({
              storageSelections: [
                ...rows,
                {
                  key: clientUuid(),
                  kind: "block",
                  tier: product.tier,
                  name: `data-${suffix}`,
                  sizeGb: product.minGb,
                  count: 1,
                  mountPath: "",
                },
              ],
            });
          }}
        >
          {t("storage.add")}
        </Button>
      }
    >
      <div className="stack">
        <small>{t("storage.deploymentBlockHint")}</small>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <Link to="/storage/file">{t("storage.manageFileStorage")}</Link>
          <Link to="/storage/object">{t("storage.manageObjectStorage")}</Link>
        </div>
        {catalog.error && (
          <span className="field-error">{t("storage.catalogError")}</span>
        )}
        {rows.map((row, index) => {
          const options = products.filter(
            (product) => product.kind === row.kind,
          );
          const product =
            options.find((p) => p.tier === row.tier) || options[0];
          if (row.kind !== "block" || !product) return (
            <div className="panel stack" key={row.key} style={{ padding: 16 }}>
              <strong>{row.name}</strong>
              <small>{t("storage.legacySelectionHint")}</small>
              <Button onClick={() => update({ storageSelections: rows.filter((item) => item.key !== row.key) })}>{t("common.delete")}</Button>
            </div>
          );
          return (
            <div className="panel stack" key={row.key} style={{ padding: 16 }}>
              <div className="between">
                <strong>{t("storage.item", { count: index + 1 })}</strong>
                <Button
                  onClick={() =>
                    update({
                      storageSelections: rows.filter((r) => r.key !== row.key),
                    })
                  }
                >
                  {t("common.delete")}
                </Button>
              </div>
              <div className="form-grid">
                <Field label={t("storage.tier")}>
                  <select
                    value={row.tier}
                    onChange={(e) => {
                      const next = options.find(
                        (p) => p.tier === e.target.value,
                      )!;
                      change(row.key, {
                        tier: next.tier,
                        sizeGb: Math.max(row.sizeGb, next.minGb),
                      });
                    }}
                  >
                    {options.map((p) => (
                      <option key={p.tier} value={p.tier}>
                        {p.tier}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t("common.name")}
                >
                  <input
                    className="input"
                    value={row.name}
                    onChange={(e) => change(row.key, { name: e.target.value })}
                  />
                </Field>
                <Field
                  label={t("storage.sizeGb")}
                  hint={`${product.minGb}–${product.maxGb} GB · ${product.stepGb} GB`}
                >
                  <input
                    className="input"
                    type="number"
                    min={product.minGb}
                    max={product.maxGb}
                    step={product.stepGb}
                    value={row.sizeGb}
                    onChange={(e) =>
                      change(row.key, { sizeGb: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label={t("storage.count")}>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={8}
                    value={row.count}
                    onChange={(e) => change(row.key, { count: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <small>
                {`${t("storage.monthlyEstimate")}: ${prices.data?.find((price) => price.key === row.key)?.monthly !== undefined ? money(prices.data.find((price) => price.key === row.key)!.monthly) : "—"}`}
              </small>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
