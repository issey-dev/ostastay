"use client"

import { useEffect } from "react"

// Registers /sw.js once the page has loaded. The worker does no caching (see public/sw.js),
// so registering it is safe in every environment; it simply makes the app installable and
// lets push notifications arrive later.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => {
        console.warn("[pwa] service worker registration failed", e)
      })
    }
    if (document.readyState === "complete") register()
    else window.addEventListener("load", register, { once: true })
  }, [])
  return null
}
