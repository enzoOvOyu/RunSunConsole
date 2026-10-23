import { useLocale } from "../../stores/locale";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { t } from "../../i18n";
import { money, number } from "../../lib/money";
const colors = [
  "var(--rs-brand)",
  "var(--rs-info)",
  "var(--rs-success)",
  "var(--rs-purple)",
];
export default function TrendChart({
  data,
  keys = ["amount"],
  currency = true,
  labels,
  timeWindow,
  unit,
}: {
  data: Record<string, unknown>[];
  keys?: string[];
  currency?: boolean;
  labels?: Record<string, string>;
  timeWindow?: string;
  unit?: string;
}) {
  const locale = useLocale((s) => s.locale);
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--rs-border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            tickFormatter={(v) =>
              String(v).includes("T")
                ? new Intl.DateTimeFormat(locale, timeWindow === "7d"
                    ? { month: "2-digit", day: "2-digit" }
                    : { hour: "2-digit", minute: "2-digit" }).format(new Date(String(v)))
                : String(v).slice(5, 10)
            }
            stroke="var(--rs-text-secondary)"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            stroke="var(--rs-text-secondary)"
            tickFormatter={(v) =>
              currency
                ? `$${number(Number(v) / 1000, 1)}k`
                : number(Number(v), 1)
            }
          />
          <Tooltip
            labelFormatter={timeWindow ? (value) => new Intl.DateTimeFormat(locale, {
              month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
            }).format(new Date(String(value))) : undefined}
            contentStyle={{
              background: "var(--rs-bg)",
              border: "1px solid var(--rs-border)",
              borderRadius: 8,
            }}
            formatter={(v, name) => [
              currency ? money(Number(v)) : `${number(Number(v), 1)}${unit ? ` ${unit}` : ""}`,
              labels?.[String(name)] || t(`common.${name}`),
            ]}
          />
          {keys.length > 1 && (
            <Legend
              formatter={(key) => labels?.[String(key)] || t(`common.${key}`)}
            />
          )}
          {keys.map((key, i) => (
            <Area
              isAnimationActive={false}
              type="monotone"
              key={key}
              dataKey={key}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.09}
              strokeWidth={2}
              stackId={keys.length > 1 ? "spend" : undefined}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
