"use client"

import { useEffect } from "react"

/**
 * Scroll behaviour for the /info marketing page.
 *
 * Renders nothing — it only wires observers onto markup the server already sent. That
 * ordering is deliberate: the page is trying to get INDEXED, so the copy must exist and
 * be visible in the server HTML, and this file may only enhance it. The `.info-js` class
 * it adds is what arms the hidden-until-revealed state in info.css; a crawler (or anyone
 * with JS off) never gets that class and therefore sees every section fully rendered.
 *
 * No animation library is used. GSAP/Framer aren't dependencies of this app and adding
 * one to a single marketing page would be a poor trade, so the effects here are
 * IntersectionObserver + a rAF-throttled scroll variable driving CSS transforms.
 */
export function InfoScrollEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".info-page")
    if (!root) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    // Arms the reveal styles. Skipped entirely under reduced-motion so nothing is ever
    // hidden from a visitor who asked for less movement.
    if (!reducedMotion.matches) root.classList.add("info-js")

    const cleanups: Array<() => void> = []

    /* -- Hero: play on load, never on scroll ---------------------------------
       The hero is above the fold by definition, so its items must not wait for an
       intersection. They previously did, and the reveal observer's -10% bottom margin
       meant that on a ~900px-tall desktop the primary call to action sat just below the
       trigger line and stayed at opacity 0 until the visitor scrolled — the one element
       on the page that can least afford to be invisible. A timer rather than
       requestAnimationFrame because rAF does not run in a document that is not painting
       (a backgrounded tab), which would reintroduce the same problem. */
    const heroReveals = Array.from(root.querySelectorAll<HTMLElement>(".info-hero .info-reveal"))
    if (heroReveals.length && !reducedMotion.matches) {
      const heroTimer = window.setTimeout(() => {
        heroReveals.forEach((el) => el.classList.add("is-in"))
      }, 60)
      cleanups.push(() => window.clearTimeout(heroTimer))
    }

    /* -- Reveal on enter ---------------------------------------------------- */
    const revealables = Array.from(root.querySelectorAll<HTMLElement>(".info-reveal"))
    if (revealables.length && !reducedMotion.matches) {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            entry.target.classList.add("is-in")
            // One-shot: re-revealing on every scroll-direction change is noise.
            revealObserver.unobserve(entry.target)
          }
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
      )
      revealables.forEach((el) => revealObserver.observe(el))
      cleanups.push(() => revealObserver.disconnect())

      // FAILSAFE. Arming .info-js hides every section until its observer fires, so any
      // situation where callbacks never arrive would leave the page blank — and a blank
      // marketing page is a far worse outcome than an un-animated one. Observers do not
      // deliver while the document is hidden (a background tab, a prerender, a headless
      // renderer that never paints), and a tab opened in the background can therefore sit
      // armed-but-unrevealed indefinitely. This reveals anything still waiting once the
      // page has had a fair chance, and is cancelled by the normal path finishing first.
      const failsafe = window.setTimeout(() => {
        revealables.forEach((el) => el.classList.add("is-in"))
      }, 2600)
      cleanups.push(() => window.clearTimeout(failsafe))
    }

    /* -- Active card in the pinned showcase ---------------------------------- */
    const stageCards = Array.from(root.querySelectorAll<HTMLElement>(".info-stage-card"))
    if (stageCards.length) {
      const stageObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            entry.target.classList.toggle("is-active", entry.isIntersecting)
          }
        },
        // A band across the middle of the viewport: a card lights up as it takes centre
        // stage and dims once it leaves, so the crimson rail tracks the read position.
        { rootMargin: "-42% 0px -42% 0px", threshold: 0 }
      )
      stageCards.forEach((el) => stageObserver.observe(el))
      cleanups.push(() => stageObserver.disconnect())
    }

    /* -- Count-up figures ---------------------------------------------------- */
    const counters = Array.from(root.querySelectorAll<HTMLElement>("[data-count-to]"))
    if (counters.length) {
      const runCount = (el: HTMLElement) => {
        const target = Number(el.dataset.countTo ?? "0")
        if (!Number.isFinite(target)) return
        if (reducedMotion.matches) {
          el.textContent = String(target)
          return
        }
        const duration = 1100
        const start = performance.now()
        let frame = 0
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration)
          // easeOutExpo — fast commitment, soft landing.
          const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
          el.textContent = String(Math.round(target * eased))
          if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        cleanups.push(() => cancelAnimationFrame(frame))
      }

      const countObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            runCount(entry.target as HTMLElement)
            countObserver.unobserve(entry.target)
          }
        },
        { threshold: 0.5 }
      )
      counters.forEach((el) => countObserver.observe(el))
      cleanups.push(() => countObserver.disconnect())
    }

    /* -- Scroll-linked custom properties -------------------------------------
       --info-scroll drives the hero's parallax layers (decorative only).
       --info-progress drives the top rail, but ONLY where CSS scroll-timeline is
       unavailable; where it exists, info.css animates the rail natively and this
       write is redundant but harmless.                                          */
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        const doc = document.documentElement
        const scrollable = doc.scrollHeight - doc.clientHeight
        root.style.setProperty("--info-scroll", String(Math.min(y / 700, 1.6)))
        root.style.setProperty("--info-progress", scrollable > 0 ? String(y / scrollable) : "0")
        ticking = false
      })
    }

    if (!reducedMotion.matches) {
      onScroll()
      window.addEventListener("scroll", onScroll, { passive: true })
      cleanups.push(() => window.removeEventListener("scroll", onScroll))
    }

    return () => cleanups.forEach((fn) => fn())
  }, [])

  return null
}
