import { useSearchParams } from "react-router-dom";
import {
  useState,
  useEffect,
  useId,
  type ReactNode,
  type RefObject,
  type ButtonHTMLAttributes,
} from "react";
import {
  Dialog as ShadDialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./sheet";
import { Button as ShadButton } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge as ShadBadge } from "./badge";
import { Tabs as ShadTabs, TabsList, TabsTrigger } from "./tabs";
import { Skeleton } from "./skeleton";
import { Checkbox } from "./checkbox";
import { Progress as ShadProgress } from "./progress";
import { Alert, AlertDescription } from "./alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import {
  Inbox,
  Info,
  X,
  AlertCircle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { create } from "zustand";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateData } from "../../lib/query-cache";
import { t, errorText } from "../../i18n";
import { date } from "../../lib/date";
import type { ResourceEvent } from "../../types/domain";
export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const mapped =
    variant === "primary"
      ? "default"
      : variant === "danger"
        ? "destructive"
        : variant === "ghost"
          ? "ghost"
          : "outline";
  return (
    <ShadButton
      type="button"
      {...props}
      variant={mapped}
      className={`btn btn-${variant} ${className}`}
    />
  );
}
export function Panel({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`panel ${className}`}>
      {title && (
        <CardHeader className="panel-head flex flex-row items-center justify-between px-5 py-4">
          <div className="row">
            <CardTitle>{title}</CardTitle>
            {hint && (
              <span
                tabIndex={0}
                title={hint}
                aria-label={hint}
                className="muted"
              >
                <Info size={14} aria-hidden="true" />
              </span>
            )}
          </div>
          {action}
        </CardHeader>
      )}
      <CardContent className="panel-body px-5 py-5">{children}</CardContent>
    </Card>
  );
}
export function Badge({ status, label }: { status: string; label?: string }) {
  const variant = /error|failed|denied|expired|abnormal/i.test(status)
    ? "destructive"
    : "secondary";
  const animated = status === "provisioning" || status === "terminating";
  return (
    <ShadBadge
      variant={variant}
      className={`badge ${status}`}
      data-status={status}
    >
      {animated && <span className="status-light" aria-hidden="true" />}
      {label || t(`common.${status}`)}
    </ShadBadge>
  );
}
export function FilterReset() {
  const [params, setParams] = useSearchParams();
  const keys = [
    "q",
    "status",
    "project_id",
    "format",
    "min_gb",
    "modality",
    "license",
    "params",
    "kind",
    "direction",
    "from",
    "to",
    "includeDeleted",
    "billing_period",
  ];
  if (!keys.some((key) => params.has(key))) return null;
  return (
    <Button
      onClick={() =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            for (const key of keys) next.delete(key);
            return next;
          },
          { replace: true },
        )
      }
    >
      {t("common.reset")}
    </Button>
  );
}
export function Empty({ text, action }: { text?: string; action?: ReactNode }) {
  const client = useQueryClient();
  return (
    <div className="empty" data-slot="empty">
      <Inbox size={28} />
      <p>{text || t("common.empty")}</p>
      {action || (
        <div className="row">
          <FilterReset />
          <Button onClick={() => invalidateData(client, { delay: 0 })}>
            {t("common.refresh")}
          </Button>
        </div>
      )}
    </div>
  );
}
export function Loading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      style={{ minHeight: 160 }}
    >
      {visible && (
        <div className="skeleton-stack" aria-hidden="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive" className="error-box stack" role="alert">
      <AlertCircle size={16} />
      <AlertDescription className="stack">
        <span>{errorText(error)}</span>
        {retry && <Button onClick={retry}>{t("common.retry")}</Button>}
      </AlertDescription>
    </Alert>
  );
}
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="row">{actions}</div>
    </header>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <ShadTabs value={value} onValueChange={onChange} className={className ? `tabs ${className}` : "tabs"}>
      <TabsList>
        {items.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className={`tab ${value === item.id ? "active" : ""}`}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </ShadTabs>
  );
}
export function Field({
  label,
  children,
  hint,
  error,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "field-wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
    </label>
  );
}
export function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  drawer = false,
  small = false,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  drawer?: boolean;
  small?: boolean;
  initialFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const descriptionId = useId();
  const onOpenAutoFocus = initialFocusRef
    ? (event: Event) => {
        event.preventDefault();
        initialFocusRef.current?.focus();
      }
    : undefined;
  const closeButton = (
    <Button variant="ghost" className="icon-btn" aria-label={t("common.close")}>
      <X size={18} />
    </Button>
  );

  if (drawer) {
    return (
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          onOpenAutoFocus={onOpenAutoFocus}
          className={`drawer ${small ? "small w-[min(760px,92vw)]" : "w-[min(1100px,92vw)]"} min-w-0 max-w-none sm:max-w-none max-[720px]:w-screen`}
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className="drawer-header">
            <div className="between">
              <SheetTitle className="dialog-title">{title}</SheetTitle>
              <SheetClose asChild>{closeButton}</SheetClose>
            </div>
            {description && (
              <SheetDescription
                id={descriptionId}
                className="dialog-description"
              >
                {description}
              </SheetDescription>
            )}
          </div>
          <div className="drawer-content">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <ShadDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={onOpenAutoFocus}
        className="dialog"
        aria-describedby={description ? descriptionId : undefined}
      >
        <div>
          <div className="between">
            <DialogTitle className="dialog-title">{title}</DialogTitle>
            <DialogClose asChild>{closeButton}</DialogClose>
          </div>
          {description && (
            <DialogDescription
              id={descriptionId}
              className="dialog-description"
            >
              {description}
            </DialogDescription>
          )}
        </div>
        {children}
      </DialogContent>
    </ShadDialog>
  );
}

export function Progress({ value }: { value: number }) {
  const safeValue = Math.min(100, Math.max(0, value));
  const level = value >= 100 ? "critical" : value >= 80 ? "warning" : "normal";
  return (
    <ShadProgress
      value={safeValue}
      aria-label={`${Math.round(safeValue)}%`}
      data-level={level}
      className="progress"
    />
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function DataTable<T>({
  data,
  columns,
  onRow,
  empty,
  paginate = true,
  pageSizeOptions = false,
  stickyColumns = false,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  onRow?: (row: T) => void;
  empty?: string;
  paginate?: boolean;
  pageSizeOptions?: boolean;
  stickyColumns?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(pageSizeOptions ? 10 : 12);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const display = paginate && pageSize !== 0
    ? rows.slice(activePage * pageSize, (activePage + 1) * pageSize)
    : rows;
  if (!data.length) return <Empty text={empty || t("common.noResults")} />;
  return (
    <>
      <div className={`table-wrap${stickyColumns ? " table-pinned" : ""}`}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((g) => (
              <TableRow key={g.id}>
                {g.headers.map((h) => (
                  <TableHead key={h.id} data-column={h.column.id}>
                    {h.column.getCanSort() ? (
                      <button onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown size={11} />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {display.map((row) => (
              <TableRow
                key={row.id}
                className={onRow ? "clickable" : ""}
                onClick={() => onRow?.(row.original)}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    ["ArrowUp", "ArrowDown"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const rows = Array.from(
                      e.currentTarget.parentElement!.querySelectorAll<HTMLTableRowElement>(
                        'tr[tabindex="0"]',
                      ),
                    );
                    const index = rows.indexOf(e.currentTarget);
                    rows[
                      Math.max(
                        0,
                        Math.min(
                          rows.length - 1,
                          index + (e.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
                    ]?.focus();
                  }
                  if (
                    e.target === e.currentTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onRow?.(row.original);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} data-column={cell.column.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {paginate && (
        <footer className={`table-footer${pageSizeOptions ? " list-pagination" : ""}`}>
          <div className="row">
            <span>{t("common.rows", { count: data.length })}</span>
            {pageSizeOptions && (
              <label className="row list-page-size">
                <span>{t("resource.pageSize")}</span>
                <select
                  aria-label={t("resource.pageSize")}
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(0);
                  }}
                >
                  {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                  <option value={0}>{t("common.all")}</option>
                </select>
              </label>
            )}
          </div>
          <div className="row">
            <Button
              aria-label={t(pageSizeOptions ? "resource.previousPage" : "common.previous")}
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              {pageSizeOptions ? t("resource.previousPage") : <ChevronLeft size={14} />}
            </Button>
            <span>{t("common.page", { page: activePage + 1 })}{pageSizeOptions && ` / ${pageCount}`}</span>
            <Button
              aria-label={t(pageSizeOptions ? "resource.nextPage" : "common.next")}
              disabled={activePage + 1 >= pageCount}
              onClick={() => setPage(activePage + 1)}
            >
              {pageSizeOptions ? t("resource.nextPage") : <ChevronRight size={14} />}
            </Button>
          </div>
        </footer>
      )}
    </>
  );
}
interface ToastItem {
  id: number;
  text: string;
  error: boolean;
  count: number;
}
let toastSequence = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const useToast = create<{
  items: ToastItem[];
  push: (text: string, error?: boolean) => void;
  remove: (id: number) => void;
}>((set, get) => ({
  items: [],
  push: (text, error = false) => {
    const previous = get().items.find(
      (item) => item.text === text && item.error === error,
    );
    const id = previous?.id ?? ++toastSequence;
    set({
      items: previous
        ? get().items.map((item) =>
            item.id === id ? { ...item, count: item.count + 1 } : item,
          )
        : [...get().items, { id, text, error, count: 1 }],
    });
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.set(
      id,
      setTimeout(() => get().remove(id), error ? 3000 : 4000),
    );
  },
  remove: (id) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    set({ items: get().items.filter((item) => item.id !== id) });
  },
}));
export const toast = (message: string, error = false) =>
  useToast.getState().push(message, error);
export function Toasts() {
  const items = useToast((state) => state.items);
  const remove = useToast((state) => state.remove);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.error ? "error" : ""}`}
          role={item.error ? "alert" : "status"}
        >
          <span>
            {item.text}
            {item.count > 1 ? ` ×${item.count}` : ""}
          </span>
          <button
            className="link-button"
            aria-label={t("common.close")}
            onClick={() => remove(item.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("common.copied"));
  } catch {
    toast(t("error.INTERNAL"), true);
  }
}
export function CopyButton({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      className="icon-btn"
      aria-label={t("common.copy")}
      onClick={() => void copy(value)}
    >
      <Copy size={13} />
    </Button>
  );
}
export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function csv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  download(
    name,
    [
      keys.map(safe).join(","),
      ...rows.map((row) => keys.map((k) => safe(row[k])).join(",")),
    ].join("\n"),
    "text/csv;charset=utf-8",
  );
}
export function EventTimeline({ events }: { events: ResourceEvent[] }) {
  return events.length ? (
    <div className="timeline">
      {events.map((e) => (
        <article className="event" key={e.id}>
          <small>
            {date(e.at)} · {e.actor} · {e.component}
          </small>
          <p>{e.reason}</p>
          <div className="row">
            <span className="chip mono">
              {e.before} → {e.after}
            </span>
            <small>
              {e.metric}: {e.value} / {e.threshold}
            </small>
          </div>
          {e.action !== "—" && <p className="muted">{e.action}</p>}
        </article>
      ))}
    </div>
  ) : (
    <Empty />
  );
}
