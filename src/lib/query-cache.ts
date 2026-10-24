import type { QueryClient, QueryKey } from "@tanstack/react-query";

type PendingInvalidation = {
  timer: ReturnType<typeof setTimeout>;
  all: boolean;
  keys: Set<QueryKey>;
};

const pending = new WeakMap<QueryClient, PendingInvalidation>();

function isPolling(query: { options: unknown }): boolean {
  const options = query.options as { refetchInterval?: unknown } | null;
  return Boolean(options?.refetchInterval);
}

/**
 * Coalesce bursty refresh signals (local mutations and realtime events) into
 * one refetch. Explicit keys refresh only those queries; otherwise polling
 * queries keep their own schedule and only the rest are invalidated.
 */
export function invalidateData(
  client: QueryClient,
  options: {
    delay?: number;
    nonPollingOnly?: boolean;
    queryKey?: QueryKey;
  } = {},
) {
  const delay = Math.max(0, options.delay ?? 150);
  const previous = pending.get(client);
  if (previous) clearTimeout(previous.timer);
  const all = previous
    ? previous.all || !options.nonPollingOnly
    : !options.nonPollingOnly;
  const keys = new Set<QueryKey>(previous?.keys ?? []);
  if (options.queryKey) keys.add(options.queryKey);
  const timer = setTimeout(() => {
    pending.delete(client);
    if (all) void client.invalidateQueries();
    else if (keys.size)
      for (const queryKey of keys)
        void client.invalidateQueries({ queryKey });
    else
      void client.invalidateQueries({
        predicate: (query) => !isPolling(query),
      });
  }, delay);
  pending.set(client, { timer, all, keys });
}
