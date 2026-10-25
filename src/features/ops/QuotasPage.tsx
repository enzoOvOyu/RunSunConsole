import { NetworkQuotas } from "./NetworkQuotas";
import { useMemo, useState, Fragment } from "react";
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
function poolGpu(resource: Resource, pool: string) {
  return resource.kind === "vgpu"
    ? resource.spec.nodePools
        .filter((item) => item.poolCode === pool)
        .reduce((sum, item) => sum + item.nodeCount * item.gpuPerNode, 0)
    : resource.nodePool === pool
      ? resource.spec.gpuCount
      : 0;
}

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
  const resources = useMemo(() => rs.data?.items || [], [rs.data]);
  const poolRows = useMemo(() => {
    const grouped = new Map<string, Resource[]>();
    for (const resource of resources) {
      const codes =
        resource.kind === "vgpu"
          ? resource.spec.nodePools.map((item) => item.poolCode)
          : [resource.nodePool];
      for (const code of new Set(codes)) {
        const list = grouped.get(code);
        if (list) list.push(resource);
        else grouped.set(code, [resource]);
      }
    }
    const ratesByPool = new Map<string, number>();
    for (const rate of rates.data || [])
      if (
        rate.unit === "per_gpu_hour" &&
        rate.pool &&
        !ratesByPool.has(rate.pool)
      )
        ratesByPool.set(rate.pool, rate.unitPrice);
    return [...grouped]
      .map(([pool, rows]) => {
        let allocated = 0;
        let running = 0;
        for (const resource of rows) {
          const gpu = poolGpu(resource, pool);
          if (
            resource.status === "running" ||
            resource.status === "provisioning"
          )
            allocated += gpu;
          if (resource.status === "running") running += gpu;
        }
        return {
          pool,
          rows,
          allocated,
          running,
          price: ratesByPool.get(pool) || 0,
        };
      })
      .filter((row) =>
        row.rows.some((resource) => poolGpu(resource, row.pool) > 0),
      );
  }, [resources, rates.data]);
  return (
    <>
      <PageHeader
        title={t("nav.quotas")}
        subtitle={t("pageDescription.quotas")}
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
        <div className="grid grid-4">
          {q.data
            ?.filter((quota) => quota.metric !== "ip")
            .flatMap((quota) =>
              quota.metric === "storage"
                ? (quota.storageBreakdown || []).map((storage) => (
                    <Panel
                      key={`storage-${storage.kind}`}
                      title={t(`quota.storage.${storage.kind}`)}
                    >
                      <div className="stat-value">
                        {number(storage.usedGb / 1000)}
                        <small> / {number(storage.limitGb / 1000)} TB</small>
                      </div>
                      <Progress
                        value={(storage.usedGb / storage.limitGb) * 100}
                      />
                    </Panel>
                  ))
                : [
                    <Panel
                      key={quota.metric}
                      title={t("quota." + quota.metric)}
                    >
                      <div className="stat-value">
                        {number(quota.usedValue)}
                        <small> / {number(quota.limitValue)}</small>
                      </div>
                      <Progress
                        value={(quota.usedValue / quota.limitValue) * 100}
                      />
                    </Panel>,
                  ],
            )}
        </div>
      )}
      <NetworkQuotas region={region} />
      <div className="section-gap">
        <Panel title={t("quota.allocated")}>
          {poolRows.length ? (
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
                  {poolRows.map(({ pool, rows, allocated, running, price }) => {
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
                          <td>{allocated}</td>
                          <td>{number(running)}</td>
                          <td>{money(price)}</td>
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
                                      {poolGpu(r, pool)} GPU
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
