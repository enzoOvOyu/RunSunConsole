export function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function rng(key: string) {
  let seed = hash(`${import.meta.env.VITE_MOCK_SEED || 20261017}:${key}`);
  return () => {
    let n = (seed += 0x6d2b79f5);
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export const seededUuid = (n: number) =>
  `8a9d0026-1017-4000-8000-${n.toString(16).padStart(12, "0")}`;
