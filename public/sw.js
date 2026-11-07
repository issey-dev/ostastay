// Uppsolut Stay service worker.
//
// Deliberately small. Today it exists so the app is installable and ready for push
// notifications (.agents/docs/NOTIFICATIONS_PLAN.md, section 6). It does NOT cache pages or
// data and has no fetch handler: a property system showing stale rooms, rates or balances is
// worse than a clear "offline" message, so every request goes straight to the network.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

// A push carries { title, body, url, tag }. The text is already privacy-safe (no guest
// names or amounts) — the server builds it that way. Open windows are told too, so a bell
// can refresh without polling.
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "Uppsolut Stay", body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "Uppsolut Stay"
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/android-chrome-192x192.png",
        badge: "/favicon-48x48.png",
        tag: data.tag || undefined,
        data: { url: data.url || "/dashboard" },
      }),
      self.clients.matchAll({ type: "window" }).then((windows) => {
        for (const w of windows) w.postMessage({ type: "notification:new", tag: data.tag || null })
      }),
    ]),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || "/dashboard"
  // Same-origin paths only — a notification can never send the user to another site.
  const url = new URL(raw, self.location.origin)
  const target = url.origin === self.location.origin ? url.href : self.location.origin + "/dashboard"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows[0]
      if (open) return open.focus().then((w) => ("navigate" in w ? w.navigate(target) : undefined))
      return self.clients.openWindow(target)
    }),
  )
})
