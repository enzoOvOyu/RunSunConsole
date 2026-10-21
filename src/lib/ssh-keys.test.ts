import { expect, it } from "vitest";
import { isValidSshPublicKey } from "./ssh-keys";

it("accepts OpenSSH ed25519 and RSA public keys and rejects malformed values", () => {
  expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO user@host")).toBe(true);
  expect(isValidSshPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ== user@host")).toBe(true);
  expect(isValidSshPublicKey("ssh-dss AAAAB3NzaC1kc3MAAACB invalid")).toBe(false);
  expect(isValidSshPublicKey("ssh-ed25519 not-a-key")).toBe(false);
});
