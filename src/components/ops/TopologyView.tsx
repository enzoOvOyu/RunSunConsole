import { Group } from "@visx/group";
import type { ResourceOf } from "../../types/domain";
import type { ClusterView } from "../../types/monitoring";
import { useData } from "../../features/shared/hooks";
import { EP } from "../../lib/api-client";
import { t } from "../../i18n";
import { Loading, ErrorState, Empty } from "../ui";
export default function TopologyView({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const nodes = q.data.nodes;
  if (!nodes.length) return <Empty />;
  const height = Math.max(300, 140 + Math.ceil(nodes.length / 6) * 80);
  return (
    <svg
      viewBox={`0 0 800 ${height}`}
      role="img"
      aria-label={t("tab.topology")}
      style={{ width: "100%", height }}
    >
      <Group top={20} left={10}>
        <rect
          x={270}
          y={0}
          width={220}
          height={40}
          rx={6}
          fill="var(--rs-surface-2)"
          stroke="var(--rs-border)"
        />
        <text
          x={380}
          y={25}
          textAnchor="middle"
          fill="var(--rs-text)"
          fontSize={12}
        >
          {r.displayId} · NVLink / IB
        </text>
        {nodes.map((node, i) => {
          const x = 25 + (i % 6) * 125;
          const y = 100 + Math.floor(i / 6) * 80;
          return (
            <Group key={node.nodeUuid}>
              <path
                d={`M380,40 L380,70 L${x + 50},70 L${x + 50},${y}`}
                stroke="var(--rs-border)"
                fill="none"
              />
              <rect
                x={x}
                y={y}
                width={100}
                height={50}
                fill="var(--rs-surface)"
                stroke={
                  node.straggler
                    ? "var(--rs-warning)"
                    : node.state === "ready"
                      ? "var(--rs-success)"
                      : "var(--rs-border)"
                }
                strokeWidth={node.straggler ? 3 : 1}
                rx={6}
              />
              <text
                x={x + 50}
                y={y + 21}
                textAnchor="middle"
                fontSize={10}
                fill="var(--rs-text)"
              >
                {node.name.split("-").slice(-2).join("-")}
              </text>
              <text
                x={x + 50}
                y={y + 38}
                textAnchor="middle"
                fontSize={9}
                fill="var(--rs-text-secondary)"
              >
                {node.poolCode}
              </text>
            </Group>
          );
        })}
      </Group>
    </svg>
  );
}
