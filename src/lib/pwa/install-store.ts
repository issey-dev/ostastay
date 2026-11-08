"use client"

import { useSyncExternalStore } from "react"

// Holds the browser's "this app can be installed" offer until the person asks for it.
//
// Chrome and Edge fire `beforeinstallprompt` once, early in the page's life, and only let
// the page show the real install dialog later if it kept the event. So a tiny listener
// (InstallCapture, mounted in the app shells) stashes it here, and the Account dialog's
// "Install app" row reads it when the person gets there. Nothing is shown on its own.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

type State = { event: InstallEvent | null; installed: boolean }

let state: State = { event: null, installed: false }
let started = false
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1)
}

/** Start listening (once per page). Safe to call from several components. */
export function startInstallCapture(): void {
  if (started || typeof window === "undefined") return
  started = true
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    set({ ...state, event: e as InstallEvent })
  })
  window.addEventListener("appinstalled", () => set({ event: null, installed: true }))
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export type InstallInfo = {
  /** Already running as the installed app: nothing to offer. */
  standalone: boolean
  /** The browser can show its own install dialog right now. */
  canPrompt: boolean
  /** iPhone / iPad: installing is Share, then Add to Home Screen. */
  ios: boolean
}

let cached: InstallInfo | null = null
function snapshot(): InstallInfo {
  const next: InstallInfo = { standalone: state.installed || isStandalone(), canPrompt: !!state.event, ios: isIos() }
  if (cached && cached.standalone === next.standalone && cached.canPrompt === next.canPrompt && cached.ios === next.ios) return cached
  cached = next
  return next
}
const SERVER: InstallInfo = { standalone: false, canPrompt: false, ios: false }

export function useInstallInfo(): InstallInfo {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER)
}

/** Show the browser's install dialog. Returns true if the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = state.event
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  // The event can only be used once.
  set({ ...state, event: null })
  return outcome === "accepted"
}
