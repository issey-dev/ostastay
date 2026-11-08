/**
 * Pure: is this a device the account has not signed in on before? A first-ever sign-in is
 * not "new" (there is nothing to compare with), and an unreadable User-Agent never alerts.
 */
export function isNewDevice(priorUserAgents: Array<string | null | undefined>, userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  const prior = priorUserAgents.filter((u): u is string => !!u)
  if (prior.length === 0) return false
  const now = deviceLabel(userAgent)
  return !prior.some((u) => deviceLabel(u) === now)
}

// "Chrome on Windows" from a User-Agent string, coarse on purpose. Comparing whole
// User-Agent strings would raise a "new device" notice at every browser update; the browser
// family plus the operating system is what a person means by "a different device".
// Recognition only, never used for access (the header is client-controlled).

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ""
  if (!ua) return "Unknown device"
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser"
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "an unknown system"
  return `${browser} on ${os}`
}
