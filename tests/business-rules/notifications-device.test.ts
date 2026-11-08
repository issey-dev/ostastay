import { describe, it, expect } from "vitest"
import { deviceLabel, isNewDevice } from "@/lib/notifications/device"

// "A sign-in from a new device" must not cry wolf at every browser update, and must not fire
// on a person's very first sign-in.

const CHROME_WIN_127 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
const CHROME_WIN_131 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const EDGE_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"

describe("device recognition", () => {
  it("names the browser and the system, in plain words", () => {
    expect(deviceLabel(CHROME_WIN_131)).toBe("Chrome on Windows")
    expect(deviceLabel(EDGE_WIN)).toBe("Edge on Windows")
    expect(deviceLabel(IPHONE)).toBe("Safari on iOS")
    expect(deviceLabel(ANDROID)).toBe("Chrome on Android")
    expect(deviceLabel(MAC_SAFARI)).toBe("Safari on Mac")
    expect(deviceLabel(null)).toBe("Unknown device")
  })

  it("a browser update on the same computer is not a new device", () => {
    expect(isNewDevice([CHROME_WIN_127], CHROME_WIN_131)).toBe(false)
  })

  it("a different browser or system is a new device", () => {
    expect(isNewDevice([CHROME_WIN_131], EDGE_WIN)).toBe(true)
    expect(isNewDevice([CHROME_WIN_131], IPHONE)).toBe(true)
    expect(isNewDevice([CHROME_WIN_131, IPHONE], ANDROID)).toBe(true)
  })

  it("a device used before, among several, is not new", () => {
    expect(isNewDevice([IPHONE, CHROME_WIN_127, ANDROID], CHROME_WIN_131)).toBe(false)
  })

  it("a first-ever sign-in, or an unreadable header, never alerts", () => {
    expect(isNewDevice([], CHROME_WIN_131)).toBe(false)
    expect(isNewDevice([null, undefined], CHROME_WIN_131)).toBe(false)
    expect(isNewDevice([CHROME_WIN_131], null)).toBe(false)
  })
})
