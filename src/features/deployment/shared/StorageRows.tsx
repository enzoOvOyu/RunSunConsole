import { Button, Field, Panel } from "../../../components/ui";
import { t } from "../../../i18n";
import { EP } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import type {
  StorageKind,
  StorageProduct,
  StorageRequest,
} from "../../../types/storage";
import { useSpec } from "./fields";

const kindNames: Record<StorageKind, string> = {
  block: "storage.kind.block",
  file: "storage.kind.file",
  object: "storage.kind.object",
};
export function StorageRows() {
  const { spec, update } = useSpec();
  const rows = spec.storageSelections || [];
  const catalog = useData<StorageProduct[]>(
    ["storage-products"],
    EP.storageProducts,
  );
  const products = catalog.data || [];
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
            while (rows.some((row) => row.mountPath === `/mnt/data-${suffix}`))
              suffix++;
            update({
              storageSelections: [
                ...rows,
                {
                  key: crypto.randomUUID(),
                  kind: "block",
                  tier: product.tier,
                  name: `data-${suffix}`,
                  sizeGb: product.minGb,
                  count: 1,
                  mountPath: `/mnt/data-${suffix}`,
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
        <small>{t("storage.formHint")}</small>
        {catalog.error && (
          <span className="field-error">{t("storage.catalogError")}</span>
        )}
        {rows.map((row, index) => {
          const options = products.filter(
            (product) => product.kind === row.kind,
          );
          const product =
            options.find((p) => p.tier === row.tier) || options[0];
          if (!product) return null;
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
                <Field label={t("common.type")}>
                  <select
                    value={row.kind}
                    onChange={(e) => {
                      const kind = e.target.value as StorageKind;
                      const next = products.find((p) => p.kind === kind)!;
                      change(row.key, {
                        kind,
                        tier: next.tier,
                        sizeGb: next.minGb,
                        count: 1,
                        mountPath:
                          kind === "object"
                            ? ""
                            : row.mountPath || `/mnt/data-${index + 1}`,
                      });
                    }}
                  >
                    {(["block", "file", "object"] as const).map((kind) => (
                      <option key={kind} value={kind}>
                        {t(kindNames[kind])}
                      </option>
                    ))}
                  </select>
                </Field>
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
                  label={
                    row.kind === "object"
                      ? t("storage.bucketName")
                      : t("common.name")
                  }
                >
                  <input
                    className="input"
                    value={row.name}
                    onChange={(e) => change(row.key, { name: e.target.value })}
                  />
                </Field>
                <Field
                  label={
                    row.kind === "object"
                      ? t("storage.quotaGb")
                      : t("storage.sizeGb")
                  }
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
                {row.kind !== "object" && (
                  <>
                    <Field label={t("storage.count")}>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={16}
                        value={row.count}
                        onChange={(e) =>
                          change(row.key, { count: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label={t("storage.mountPath")}>
                      <input
                        className="input"
                        value={row.mountPath}
                        onChange={(e) =>
                          change(row.key, { mountPath: e.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
              <small>
                {row.kind === "object"
                  ? t("storage.objectBilling")
                  : `${t("storage.monthlyEstimate")}: $${(row.sizeGb * row.count * product.usdGbMonth).toFixed(2)}`}
              </small>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
