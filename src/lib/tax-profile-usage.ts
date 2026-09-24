// What still points at a Custom Tax profile, and the message DELETE /api/taxes/[id]
// returns (409) when something does. Returns null when the profile is free to delete.
export function taxProfileInUseMessage(
  profileName: string,
  usage: { chargeCodes: number; outlets: number },
): string | null {
  const parts: string[] = []
  if (usage.chargeCodes > 0) parts.push(`${usage.chargeCodes} charge code${usage.chargeCodes === 1 ? "" : "s"}`)
  if (usage.outlets > 0) parts.push(`${usage.outlets} outlet${usage.outlets === 1 ? "" : "s"}`)
  if (parts.length === 0) return null
  return `"${profileName}" is used by ${parts.join(" and ")}. Move ${usage.chargeCodes + usage.outlets === 1 ? "it" : "them"} to another tax setting first, then delete the profile.`
}
