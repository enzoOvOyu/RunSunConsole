export interface SshKey {
  id: string;
  name: string;
  publicKey: string;
  createdAt: string;
}

const STORAGE_KEY = "runsun.ssh-keys.v1";
const PUBLIC_KEY_PATTERN = /^ssh-(?:ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/;

export function isValidSshPublicKey(value: string) {
  return PUBLIC_KEY_PATTERN.test(value.trim());
}

export function readSshKeys(): SshKey[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored)
      ? stored.filter(
          (key): key is SshKey =>
            !!key &&
            typeof key.id === "string" &&
            typeof key.name === "string" &&
            typeof key.publicKey === "string" &&
            isValidSshPublicKey(key.publicKey),
        )
      : [];
  } catch {
    return [];
  }
}

export function writeSshKeys(keys: SshKey[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}
