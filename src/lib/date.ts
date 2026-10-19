import { useLocale } from "../stores/locale";
export function date(value: string | null, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(useLocale.getState().locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
}
export function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(seconds % 60)}s`;
}
export const period = () => new Date().toISOString().slice(0, 7);
