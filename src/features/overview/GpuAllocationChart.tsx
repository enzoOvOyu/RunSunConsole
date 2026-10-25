import { memo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { t } from "../../i18n";
import { number } from "../../lib/money";
import { useLocale } from "../../stores/locale";
import { OverviewReveal } from "./OverviewMotion";

export const GpuAllocationChart = memo(function GpuAllocationChart({
  models,
}: {
  models: { name: string; total: number }[];
}) {
  useLocale((state) => state.locale);
  const [played, setPlayed] = useState(false);
  const largestGpuModel = Math.max(1, ...models.map((model) => model.total));
  return (
    <OverviewReveal
      className="overview-gpu-chart"
      data-entrance-complete={played}
      onAnimationEnd={(event) => {
        if (event.animationName === "overview-bar-load") setPlayed(true);
      }}
      role="img"
      aria-label={t("overview.gpuModels")}
      style={{
        height: `${Math.max(186, models.length * 36 + 28)}px`,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={models}
          layout="vertical"
          margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
          barCategoryGap="24%"
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--rs-border)"
            strokeDasharray="3 3"
          />
          <XAxis
            type="number"
            domain={[0, Math.max(1, largestGpuModel)]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => number(Number(value))}
            stroke="var(--rs-text-secondary)"
            fontSize={11}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={104}
            tickLine={false}
            axisLine={false}
            stroke="var(--rs-text-secondary)"
            fontSize={11}
          />
          <Tooltip
            cursor={{ fill: "var(--rs-surface-2)" }}
            contentStyle={{
              background: "var(--rs-bg)",
              border: "1px solid var(--rs-border)",
              borderRadius: 8,
            }}
            formatter={(value) => [
              t("overview.gpuCards", {
                count: number(Number(value)),
              }),
              t("overview.allocated"),
            ]}
          />
          <Bar
            dataKey="total"
            fill="var(--rs-brand)"
            radius={[0, 5, 5, 0]}
            maxBarSize={20}
            minPointSize={1}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="total"
              position="right"
              formatter={(value) => number(Number(value))}
              className="overview-gpu-total-label"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </OverviewReveal>
  );
});
