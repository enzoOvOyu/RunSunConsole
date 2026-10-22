import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { t } from "../../i18n";
import { useLocale } from "../../stores/locale";
import "./billing-period-picker.css";

function periodParts(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match
    ? { year: Number(match[1]), month: Number(match[2]) }
    : { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 };
}

export function BillingPeriodPicker({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (period: string) => void;
  max?: string;
}) {
  const locale = useLocale((state) => state.locale);
  const selected = periodParts(value);
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(selected.year);
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  const fullPeriod = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const yearName = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    timeZone: "UTC",
  });
  const formatYear = (year: number) =>
    yearName.format(new Date(Date.UTC(year, 0, 1)));
  const selectedLabel = fullPeriod.format(
    new Date(Date.UTC(selected.year, selected.month - 1, 1)),
  );
  const maxYear = max ? periodParts(max).year : undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setVisibleYear(selected.year);
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          className="billing-period-trigger"
          aria-label={`${t("billing.period")}: ${selectedLabel}`}
          aria-expanded={open}
        >
          <CalendarDays size={16} aria-hidden="true" />
          <span>{selectedLabel}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="billing-period-popover">
        <div className="billing-period-header">
          <Button
            variant="ghost"
            className="billing-period-nav"
            aria-label={t("billing.previousYear")}
            disabled={visibleYear <= 1970}
            onClick={() => setVisibleYear((year) => year - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <strong>{formatYear(visibleYear)}</strong>
          <Button
            variant="ghost"
            className="billing-period-nav"
            aria-label={t("billing.nextYear")}
            disabled={maxYear !== undefined && visibleYear >= maxYear}
            onClick={() => setVisibleYear((year) => year + 1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
        <div className="billing-period-months">
          {Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const period = `${visibleYear}-${String(month).padStart(2, "0")}`;
            const date = new Date(Date.UTC(visibleYear, index, 1));
            return (
              <button
                key={period}
                type="button"
                className="billing-period-month"
                aria-label={fullPeriod.format(date)}
                aria-pressed={period === value}
                disabled={!!max && period > max}
                onClick={() => {
                  onChange(period);
                  setOpen(false);
                }}
              >
                {monthName.format(date)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
