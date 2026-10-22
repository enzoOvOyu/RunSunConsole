export function invoicePeriodForSelection(
  selectedPeriod: string,
  currentPeriod = new Date().toISOString().slice(0, 7),
): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedPeriod)) return null;
  if (selectedPeriod > currentPeriod) return null;
  if (selectedPeriod < currentPeriod) return selectedPeriod;
  const [year, month] = selectedPeriod.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}
