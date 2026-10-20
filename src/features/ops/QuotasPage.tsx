import { useState, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Quota, Resource, Rate } from "../../types/domain";
import { useRegion } from "../../stores/region";
import { EP, query } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { money, number } from "../../lib/money";
import {
  Panel,
  PageHeader,
  Progress,
  Badge,
  Loading,
  ErrorState,
  Empty,
  Button,
} from "../../components/ui";
export default function QuotasPage() {
  const region = useRegion((s) => s.region);
  const q = useData<Quota[]>(
    ["quotas", region],
    EP.quotas + query({ region }),
    { poll: true },
  );
  const rs = useData<{ items: Resource[] }>(
    ["quota-resources", region],
    EP.resources + query({ region, size: 1000 }),
  );
  const rates = useData<Rate[]>(
    ["rates", region],
    EP.rates + query({ region }),
  );
  const [expanded, setExpanded] = useState("");
  const navigate = useNavigate();
  const resources = rs.data?.items || [];
  const pools = [...new Set(resources.map((r) => r.nodePool))];
  return (
    <>
      <PageHeader
        title={t("nav.quotas")}
        actions={
          <Button onClick={() => navigate("/ops/tickets?new=quota")}>
            {t("quota.request")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter />
      </div>
      <p className="notice" style={{ marginBottom: 20 }}>
        {t("quota.note")}
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="grid quota-grid">
          {q.data?.map((quota) => (
            <Panel key={quota.metric} title={t("quota." + quota.metric)}>
              <div className="stat-value">
                {number(quota.usedValue)}
                <small> / {number(quota.limitValue)}</small>
              </div>
              <Progress value={(quota.usedValue / quota.limitValue) * 100} />
            </Panel>
          ))}
        </div>
      )}
      <div className="section-gap">
        <Panel title={t("quota.allocated")}>
          {pools.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("resource.pool")}</th>
                    <th>{t("common.region")}</th>
                    <th>{t("overview.allocated")}</th>
                    <th>{t("quota.runningGpu")}</th>
                    <th>{t("common.price")} · USD/GPU·h</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool) => {
                    const rows = resources.filter((r) => r.nodePool === pool);
                    return (
                      <Fragment key={pool}>
                        <tr
                          className="clickable"
                          onClick={() =>
                            setExpanded(expanded === pool ? "" : pool)
                          }
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              setExpanded(expanded === pool ? "" : pool);
                          }}
                        >
                          <td>{pool}</td>
                          <td>{t("common." + region)}</td>
                          <td>
                            {rows.reduce((a, r) => a + r.spec.gpuCount, 0)}
                          </td>
                          <td>
                            {number(
                              rows
                                .filter((r) => r.status === "running")
                                .reduce((n, r) => n + r.spec.gpuCount, 0),
                            )}
                          </td>
                          <td>
                            {money(
                              rates.data?.find(
                                (r) =>
                                  r.pool === pool && r.unit === "per_gpu_hour",
                              )?.unitPrice || 0,
                            )}
                          </td>
                        </tr>
                        {expanded === pool && (
                          <tr>
                            <td colSpan={5}>
                              <div className="inline-detail stack">
                                {rows.map((r) => (
                                  <div className="between" key={r.resourceUuid}>
                                    <Link to={resourceLink(r)}>
                                      {dt(r.name)} · {r.displayId}
                                    </Link>
                                    <span className="row">
                                      <Badge status={r.status} />
                                      {r.spec.gpuCount} GPU
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )}
        </Panel>
      </div>
    </>
  );
}
