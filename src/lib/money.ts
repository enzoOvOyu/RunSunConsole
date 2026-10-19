import { useLocale } from "../stores/locale";
export const round = (v: number, digits = 2) =>
  Math.round((v + Number.EPSILON) * 10 ** digits) / 10 ** digits;
export const money = (v: number) =>
  new Intl.NumberFormat(useLocale.getState().locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
export const number = (v: number, digits = 0) =>
  new Intl.NumberFormat(useLocale.getState().locale, {
    maximumFractionDigits: digits,
  }).format(v);
export const size = (gb: number) =>
  gb >= 1024 ? `${number(gb / 1024, 2)} TB` : `${number(gb, 1)} GB`;

export const unitMoney = (v: number) =>
  new Intl.NumberFormat(useLocale.getState().locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: v !== 0 && Math.abs(v) < 0.01 ? 6 : 2,
  }).format(v);
