import { randomBytes } from "crypto"
import { mkdir, writeFile, readFile, unlink } from "fs/promises"
import path from "path"
import { LOGO_WIDTH, LOGO_HEIGHT, MAX_LOGO_BYTES } from "@/lib/property-logo-spec"

// A property's uploaded logo (owner, 2026-09-24). The browser crops it to the fixed 3:2
// frame and exports a LOGO_WIDTH × LOGO_HEIGHT PNG (transparency kept; PNG, not WebP,
// because Outlook desktop can't show WebP in the emails the logo goes into); this module
// only verifies and stores that result — no server-side image library.
//
// Stored under storage/logos — the same persisted volume as the eRegistration uploads
// (docker-compose mounts /app/storage), never public/: the standalone build only serves
// public/ files that existed at build time. Served by GET /api/logos/[file]. Each upload
// gets a fresh random name, so the file behind a URL never changes and can be cached for
// good; Property.logoUrl holds that URL.

const STORAGE_ROOT = path.join(process.cwd(), "storage", "logos")

export const LOGO_URL_PREFIX = "/api/logos/"

export class LogoValidationError extends Error {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width and height from a PNG's IHDR chunk, or null if this isn't a PNG. */
export function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export function validateLogo(buffer: Buffer): void {
  if (buffer.length === 0) throw new LogoValidationError("The logo file is empty.")
  if (buffer.length > MAX_LOGO_BYTES) throw new LogoValidationError("The logo must be under 2.5 MB after cropping.")
  const size = pngSize(buffer)
  if (!size) throw new LogoValidationError("The logo must be a PNG exported by the logo cropper.")
  if (size.width !== LOGO_WIDTH || size.height !== LOGO_HEIGHT) {
    throw new LogoValidationError(`The logo must be ${LOGO_WIDTH} × ${LOGO_HEIGHT} px.`)
  }
}

/** Store a verified logo for a property; returns the URL to keep in Property.logoUrl. */
export async function saveLogo(propertyId: string, buffer: Buffer): Promise<string> {
  validateLogo(buffer)
  await mkdir(STORAGE_ROOT, { recursive: true })
  // Server-generated name only: the property id (a UUID) and a random suffix.
  const filename = `${propertyId.replace(/[^a-zA-Z0-9-]/g, "")}-${randomBytes(6).toString("hex")}.png`
  await writeFile(path.join(STORAGE_ROOT, filename), buffer)
  return `${LOGO_URL_PREFIX}${filename}`
}

/** The stored file name behind one of our logo URLs, or null for anything else. */
export function logoFileFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(LOGO_URL_PREFIX)) return null
  const name = url.slice(LOGO_URL_PREFIX.length)
  return isSafeLogoName(name) ? name : null
}

export function isSafeLogoName(name: string): boolean {
  return /^[a-zA-Z0-9-]+\.png$/.test(name) && path.basename(name) === name
}

export async function readLogo(name: string): Promise<Buffer> {
  if (!isSafeLogoName(name)) throw new LogoValidationError("Invalid logo reference")
  return readFile(path.join(STORAGE_ROOT, name))
}

/** Remove a replaced logo's file. A missing file is fine — the goal is that it's gone. */
export async function deleteLogoFile(url: string | null | undefined): Promise<void> {
  const name = logoFileFromUrl(url)
  if (!name) return
  await unlink(path.join(STORAGE_ROOT, name)).catch(() => {})
}

/**
 * A logo URL that works outside this app — in an email, or on a property's own website via
 * the Booking API. Our uploaded logos are stored as a path on this deployment; external URLs
 * (the Logo URL field some properties still carry) pass through unchanged.
 */
export function absoluteLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!url.startsWith("/")) return url
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}${url}`
}
