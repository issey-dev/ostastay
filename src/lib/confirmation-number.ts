// Pure (no database) so both the server and the Hub's booking-format form can use it.
// A booking number for this property: its prefix (or "{code}-" when none is set) plus the
// counter zero-padded to the configured length.
export function formatConfirmationNumber(
  settings: { resConfirmPrefix: string; resConfirmLength: number },
  propertyCode: string,
  counter: number
): string {
  const prefix = settings.resConfirmPrefix || `${propertyCode}-`
  const length = settings.resConfirmLength || 6
  return `${prefix}${String(counter).padStart(length, "0")}`
}
