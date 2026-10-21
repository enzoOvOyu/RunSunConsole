import { useAuth } from "../stores/auth";
export const EP = {
  network: "/api/network",
  resourceNetwork: (uuid: string) => `/api/resources/${uuid}/network`,
  machines: (uuid: string) => `/api/resources/${uuid}/machines`,
  governance: (uuid: string) => `/api/resources/${uuid}/governance`,
  options: "/api/deployment-options",
  overview: "/api/overview",
  resources: "/api/resources",
  projects: "/api/projects",
  pools: "/api/node-pools",
  rates: "/api/billing/rates",
  summary: "/api/billing/summary",
  usage: "/api/billing/usage",
  transactions: "/api/billing/transactions",
  invoices: "/api/billing/invoices",
  vouchers: "/api/billing/vouchers",
  orders: "/api/deployment-orders",
  quotas: "/api/quotas",
  account: "/api/account",
  metrics: "/api/metrics",
  events: "/api/events",
  operations: "/api/operations",
  notifications: "/api/notifications",
  notebooks: "/api/workbench/notebooks",
  images: "/api/images",
  models: "/api/models",
  apps: "/api/apps",
  policies: "/api/scaling/policies",
  scalingEvents: "/api/scaling/events",
  datasets: "/api/datasets",
  buckets: "/api/buckets",
  storageProducts: "/api/storage/products",
  storageVolumes: "/api/storage/volumes",
  pipelines: "/api/pipelines",
  pipelineRuns: "/api/pipeline-runs",
  tickets: "/api/tickets",
} as const;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
export function query(
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.size ? `?${p}` : "";
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base =
    import.meta.env.VITE_ENABLE_MOCK === "false"
      ? import.meta.env.VITE_API_BASE_URL || ""
      : "";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Role": useAuth.getState().role,
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body.code || "INTERNAL", body);
  return body as T;
}
export const post = <T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => api<T>(path, { method: "POST", headers, body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const remove = <T>(path: string) => api<T>(path, { method: "DELETE" });
