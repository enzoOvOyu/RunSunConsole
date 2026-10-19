const start = Date.now();
export const FAULT_TTL_MS = 15 * 60 * 1000;
const faults = [
  "oom",
  "xid48",
  "network",
  "straggler",
  "insufficient",
  "billing",
];
export function faultFor(url: URL) {
  const current =
    url.searchParams.get("fault") ||
    new URLSearchParams(
      typeof location !== "undefined" ? location.search : "",
    ).get("fault") ||
    import.meta.env.VITE_MOCK_FAULT ||
    "";
  return Date.now() - start < FAULT_TTL_MS && faults.includes(current)
    ? current
    : "";
}
