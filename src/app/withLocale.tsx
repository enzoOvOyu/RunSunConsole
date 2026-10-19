import { createElement, type ComponentType } from "react";
import { useLocale } from "../stores/locale";
export function withLocale(Page: ComponentType) {
  return function LocalizedPage() {
    useLocale((s) => s.locale);
    return createElement(Page);
  };
}
