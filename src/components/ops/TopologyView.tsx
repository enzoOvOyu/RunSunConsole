import { Group } from "@visx/group";
import type { ResourceOf } from "../../types/domain";
import { t } from "../../i18n";
export default function TopologyView({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const count = Math.min(
    12,
    r.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0),
  );
  return (
    <svg
      viewBox="0 0 800 300"
      role="img"
      aria-label={t("tab.topology")}
      style={{ width: "100%", height: 300 }}
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
        {Array.from({ length: count }, (_, i) => {
          const x = 25 + (i % 6) * 125;
          const y = 100 + Math.floor(i / 6) * 80;
          return (
            <Group key={i}>
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
                  r.status === "running"
                    ? "var(--rs-success)"
                    : "var(--rs-border)"
                }
                rx={6}
              />
              <text
                x={x + 50}
                y={y + 21}
                textAnchor="middle"
                fontSize={11}
                fill="var(--rs-text)"
              >
                {r.displayId.slice(0, 9)}-{i + 1}
              </text>
              <text
                x={x + 50}
                y={y + 38}
                textAnchor="middle"
                fontSize={10}
                fill="var(--rs-text-secondary)"
              >
                {r.nodePool}
              </text>
            </Group>
          );
        })}
      </Group>
    </svg>
  );
}
