import { useConnection } from "../../stores/connection";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api-client";
import { invalidateData } from "../../lib/query-cache";
import { toast } from "../../components/ui";
import { errorText, t } from "../../i18n";
export const pollInterval = Number(
  import.meta.env.VITE_POLL_INTERVAL_MS || 10000,
);
export function useData<T>(
  key: readonly unknown[],
  path: string,
  options: { enabled?: boolean; poll?: boolean; pollMs?: number } = {},
) {
  const mode = useConnection((s) => options.poll ? s.mode : null);
  return useQuery<T>({
    queryKey: key,
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: options.enabled,
    refetchInterval:
      options.poll && mode !== "websocket" && mode !== "stream"
        ? (options.pollMs ?? pollInterval)
        : false,
  });
}
export function useAction() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run<T>(
    action: () => Promise<T>,
    success = "success.saved",
  ): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      if (mounted.current) invalidateData(client, { delay: 100 });
      toast(t(success));
      return result;
    } catch (error) {
      toast(errorText(error), true);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return { run, busy };
}
export function useDebounced(value: string, ms = 200) {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setState(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return state;
}
