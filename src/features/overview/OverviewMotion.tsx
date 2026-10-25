import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { useLocale } from "../../stores/locale";
import { t } from "../../i18n";
import { Skeleton } from "../../components/ui/skeleton";

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useEntrance<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  useEffect(() => {
    if (visible || reduced) return;
    const element = ref.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, reduced]);
  return { ref, visible, reduced };
}

export function OverviewReveal(props: ComponentProps<"div">) {
  const { ref, visible, reduced } = useEntrance<HTMLDivElement>();
  return (
    <div
      {...props}
      ref={ref}
      data-overview-reveal={visible || reduced ? "visible" : "waiting"}
    />
  );
}

export function OverviewValue({
  value,
  currency = false,
  animateUpdates = false,
}: {
  value: number;
  currency?: boolean;
  animateUpdates?: boolean;
}) {
  const locale = useLocale((state) => state.locale);
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(
        locale,
        currency
          ? {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          : { maximumFractionDigits: 0 },
      ),
    [locale, currency],
  );
  const { ref, visible, reduced } = useEntrance<HTMLSpanElement>();
  const output = useRef<HTMLSpanElement>(null);
  const current = useRef(0);
  const played = useRef(false);
  useEffect(() => {
    const element = output.current;
    if (!element) return;
    const write = (amount: number) => {
      current.current = amount;
      element.textContent = formatter.format(amount);
    };
    if (reduced || (played.current && !animateUpdates)) {
      write(value);
      played.current = true;
      return;
    }
    if (!visible) {
      write(0);
      return;
    }
    const from = current.current;
    const duration = played.current ? 320 : 1000;
    played.current = true;
    if (from === value) {
      write(value);
      return;
    }
    let frame: number;
    let start: number | undefined;
    const tick = (time: number) => {
      start ??= time;
      const progress = Math.min(1, (time - start) / duration);
      write(
        progress === 1
          ? value
          : from + (value - from) * (1 - (1 - progress) ** 3),
      );
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, formatter, visible, reduced, animateUpdates]);
  return (
    <span ref={ref} className="overview-animated-value">
      <span ref={output} aria-hidden="true" />
      <span className="sr-only">{formatter.format(value)}</span>
    </span>
  );
}

export function OverviewSkeleton() {
  return (
    <div
      className="overview-loading"
      role="status"
      aria-label={t("common.loading")}
    >
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="overview-loading-title" />
      <div className="overview-loading-summary" aria-hidden="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <Skeleton className="overview-loading-panel" aria-hidden="true" />
      <Skeleton className="overview-loading-panel" aria-hidden="true" />
    </div>
  );
}
