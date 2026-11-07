"use client"

// Browser side of phone push: ask permission, subscribe this device, and — importantly —
// forget it again when the person signs out (a shared front-desk PC or phone must not keep
// receiving the previous person's alerts). Everything here is best-effort and never throws.

export type PushSupport =
  | { state: "unsupported" }
  | { state: "needs-install" } // iPhone/iPad Safari tab: push only works from the Home Screen app
  | { state: "denied" }
  | { state: "off" }
  | { state: "on" }

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/")
    return (await reg?.pushManager.getSubscription()) ?? null
  } catch {
    return null
  }
}

export async function pushSupport(): Promise<PushSupport> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) {
    return isIos() && !isStandalone() ? { state: "needs-install" } : { state: "unsupported" }
  }
  if (isIos() && !isStandalone()) return { state: "needs-install" }
  if (!("PushManager" in window)) return { state: "unsupported" }
  if (Notification.permission === "denied") return { state: "denied" }
  return (await currentSubscription()) ? { state: "on" } : { state: "off" }
}

function toKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const raw = atob((base64Url + pad).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Must be called from a click. Returns null on success, or a short message for the person. */
export async function enablePush(publicKey: string): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== "granted") return "Notifications are blocked for this site. Allow them in the browser's site settings, then try again."
    const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }))
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }))
    const res = await fetch("/api/notifications/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    })
    if (!res.ok) return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not turn on phone notifications."
    return null
  } catch {
    return "Could not turn on phone notifications on this device."
  }
}

/** Turn off for this device: unsubscribe in the browser (stops delivery) and tell the server. */
export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await fetch("/api/notifications/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
  } catch {
    /* nothing more to do */
  }
}

/** Call right before signing out. Never throws, never waits long. */
export async function signOutCleanup(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  await Promise.race([disablePush(), new Promise<void>((r) => setTimeout(r, 2500))])
}
