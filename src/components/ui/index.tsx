import { useSearchParams } from "react-router-dom";
import {
  useState,
  useEffect,
  useId,
  type ReactNode,
  type RefObject,
  type ButtonHTMLAttributes,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Inbox,
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
  return (
    <button
      type="button"
      {...props}
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
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <div className="row">
            <h2>{title}</h2>
            {hint && (
              <span
                tabIndex={0}
                title={hint}
                aria-label={hint}
                className="muted"
              >
                ⓘ
              </span>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`badge ${status}`}>{label || t(`common.${status}`)}</span>
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
    <div className="empty">
      <Inbox size={28} />
      <p>{text || t("common.empty")}</p>
      {action || (
        <div className="row">
          <FilterReset />
          <Button onClick={() => void client.invalidateQueries()}>
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
        <div className="skeleton" aria-hidden="true">
          <div />
          <div />
          <div />
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
    <div role="alert" className="error-box stack">
      <div className="row">
        <AlertCircle size={16} />
        {errorText(error)}
      </div>
      {retry && <Button onClick={retry}>{t("common.retry")}</Button>}
    </div>
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
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          role="tab"
          aria-selected={value === item.id}
          key={item.id}
          className={`tab ${value === item.id ? "active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
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
      <span>{label}</span>
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
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
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
  description?: string;
  children: ReactNode;
  drawer?: boolean;
  small?: boolean;
  initialFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
  const descriptionId = useId();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          onOpenAutoFocus={
            initialFocusRef
              ? (event) => {
                  event.preventDefault();
                  initialFocusRef.current?.focus();
                }
              : undefined
          }
          className={drawer ? `drawer ${small ? "small" : ""}` : "dialog"}
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className={drawer ? "drawer-header" : ""}>
            <div className="between">
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  className="icon-btn"
                  aria-label={t("common.close")}
                >
                  <X size={18} />
                </Button>
              </Dialog.Close>
            </div>
            {description && (
              <Dialog.Description
                id={descriptionId}
                className="dialog-description"
              >
                {description}
              </Dialog.Description>
            )}
          </div>
          <div className={drawer ? "drawer-content" : ""}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background:
            value >= 100
              ? "var(--rs-danger)"
              : value >= 80
                ? "var(--rs-warning)"
                : undefined,
        }}
      />
    </div>
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
}: {
  data: T[];
  columns: ColumnDef<T>[];
  onRow?: (row: T) => void;
  empty?: string;
  paginate?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;
  const activePage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 12) - 1),
  );
  const display = paginate
    ? rows.slice(activePage * 12, (activePage + 1) * 12)
    : rows;
  if (!data.length) return <Empty text={empty || t("common.noResults")} />;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>
                    <button
                      onClick={h.column.getToggleSortingHandler()}
                      disabled={!h.column.getCanSort()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() && <ArrowUpDown size={11} />}
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {display.map((row) => (
              <tr
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
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginate && (
        <footer className="table-footer">
          <span>{t("common.rows", { count: data.length })}</span>
          <div className="row">
            <Button
              aria-label={t("common.previous")}
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            {t("common.page", { page: activePage + 1 })}
            <Button
              aria-label={t("common.next")}
              disabled={(activePage + 1) * 12 >= rows.length}
              onClick={() => setPage(activePage + 1)}
            >
              <ChevronRight size={14} />
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
    if (!error)
      timers.set(
        id,
        setTimeout(() => get().remove(id), 4000),
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
  const { items, remove } = useToast();
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
