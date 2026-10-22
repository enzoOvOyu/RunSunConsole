/** Stable, resource-scoped fingerprint for local console password checks. */
export function consolePasswordFingerprint(
  resourceUuid: string,
  password: string,
) {
  const input = `${resourceUuid}:${password}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
