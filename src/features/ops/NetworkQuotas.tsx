import { Link } from "react-router-dom";
import type { Project, Region } from "../../types/domain";
import type { NetworkQuota, SubnetView, EipView } from "../../types/network";
import { EP, query } from "../../lib/api-client";
import { formatResourceId } from "../../lib/ids";
import { SUBNET_RESERVED_IPS } from "../../lib/network";
import { useData } from "../shared/hooks";
import { t, dt } from "../../i18n";
import { number } from "../../lib/money";
import {
  Panel,
  DataTable,
  Progress,
  Loading,
  ErrorState,
} from "../../components/ui";
export function NetworkQuotas({ region }: { region: Region }) {
  const q = useData<NetworkQuota[]>(
    ["network-quotas", region],
    `${EP.network}/quotas` + query({ region }),
    { poll: true },
  );
  const subnets = useData<SubnetView[]>(
    ["network-quota-subnets", region],
    `${EP.network}/subnets` + query({ region }),
    { poll: true },
  );
  const eips = useData<EipView[]>(
    ["network-quota-eips", region],
    `${EP.network}/eips` + query({ region }),
    { poll: true },
  );
  const projects = useData<Project[]>(["projects"], EP.projects);
  return (
    <div className="stack section-gap">
      <Panel
        title={t("quota.network")}
        hint={t("quota.networkHint")}
        action={
          <Link to={`/network/vpcs?region=${region}`}>{t("nav.network")}</Link>
        }
      >
        <p className="muted">{t("quota.networkScope")}</p>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={q.data || []}
            paginate={false}
            columns={[
              {
                id: "metric",
                header: t("quota.item"),
                cell: ({ row }) => (
                  <Link to={row.original.href}>
                    {t(`quota.${row.original.metric}`)}
                  </Link>
                ),
              },
              {
                accessorKey: "usedValue",
                header: t("quota.used"),
                cell: ({ row }) => number(row.original.usedValue),
              },
              {
                accessorKey: "limitValue",
                header: t("quota.limit"),
                cell: ({ row }) => number(row.original.limitValue),
              },
              {
                accessorKey: "remaining",
                header: t("quota.remaining"),
                cell: ({ row }) => number(row.original.remaining),
              },
              {
                id: "progress",
                header: t("quota.utilization"),
                cell: ({ row }) => (
                  <div style={{ minWidth: 120 }}>
                    <small>
                      {Math.round(
                        (row.original.usedValue / row.original.limitValue) *
                          100,
                      )}
                      %
                    </small>
                    <Progress
                      value={
                        (row.original.usedValue / row.original.limitValue) * 100
                      }
                    />
                  </div>
                ),
              },
              {
                id: "request",
                header: t("common.actions"),
                cell: ({ row }) => (
                  <Link
                    to={`/ops/tickets?new=quota&metric=${row.original.metric}&region=${region}`}
                  >
                    {t("quota.request")}
                  </Link>
                ),
              },
            ]}
          />
        )}
        {eips.error ? (
          <ErrorState error={eips.error} />
        ) : eips.isPending ? (
          <Loading />
        ) : (
          <div className="notice" style={{ marginTop: 16 }}>
            {t("quota.eipBreakdown", {
              idle: eips.data.filter((e) => !e.interfaceId && !e.tunnelId)
                .length,
              vm: eips.data.filter((e) => !!e.interfaceId).length,
              tunnel: eips.data.filter((e) => !!e.tunnelId).length,
            })}{" "}
            {t("network.eipRetention")}
          </div>
        )}
      </Panel>
      <Panel title={t("quota.privateAddresses")} hint={t("network.subnetHint", { count: SUBNET_RESERVED_IPS })}>
        <p className="muted">{t("quota.addressHint", { count: SUBNET_RESERVED_IPS })}</p>
        {subnets.isPending ? (
          <Loading />
        ) : subnets.error ? (
          <ErrorState error={subnets.error} />
        ) : (
          <DataTable
            data={subnets.data || []}
            columns={[
              {
                id: "name",
                header: t("network.subnet"),
                cell: ({ row }) => (
                  <Link
                    to={`/network/vpcs?region=${region}&drawer=${row.original.vpcId}`}
                  >
                    {dt(row.original.name)}
                    <small className="resource-id"> · {formatResourceId("sub", row.original.id)}</small>
                  </Link>
                ),
              },
              {
                id: "project",
                header: t("common.project"),
                cell: ({ row }) =>
                  dt(
                    projects.data?.find((p) => p.id === row.original.projectId)
                      ?.name || formatResourceId("prj", row.original.projectId),
                  ),
              },
              { accessorKey: "cidr", header: t("network.cidr") },
              { accessorKey: "usedIps", header: t("network.usedIps") },
              {
                accessorKey: "availableIps",
                header: t("network.availableIps"),
                cell: ({ row }) => number(row.original.availableIps),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
