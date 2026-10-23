/** Shared password policy for GPU VM and bare metal login. */
export function validResourcePassword(value: string): boolean {
  return value.length >= 12 && value.length <= 128 &&
    [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3;
}
