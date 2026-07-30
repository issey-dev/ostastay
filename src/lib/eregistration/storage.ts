import { randomUUID } from "crypto";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";

// Local disk, under a private directory never served statically (never under public/) —
// this app has no upload infrastructure anywhere else (confirmed: no S3/blob client, no
// multer/formidable, ProfileAttachment is explicitly a URL-reference list, not real
// storage). This assumes a single persistent-disk app instance, same as SQLite itself
// already assumes; a serverless/multi-instance deployment would need real object storage
// behind this same interface — this module is the one seam to swap for that later.
const STORAGE_ROOT = path.join(process.cwd(), "storage", "eregistration-uploads");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ~10MB — common phone-camera JPEG range

export class UploadValidationError extends Error {}

type SniffedImage = { mimeType: string; extension: string };

// Magic-byte sniff, never trust the client-supplied File.type — this is a public,
// unauthenticated upload endpoint. No file-type-sniffing dependency exists in this app;
// the byte signatures for the handful of formats a phone/browser actually produces are
// small enough to hand-check rather than add a new dependency for.
export function sniffImageType(buffer: Buffer): SniffedImage | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12).trim();
    if (["heic", "heix", "mif1", "msf1", "heim", "heis"].includes(brand)) {
      return { mimeType: "image/heic", extension: "heic" };
    }
  }
  return null;
}

// Server-generated filename only, never the client-supplied one — closes off path
// traversal outright rather than relying on sanitizing an attacker-controlled string.
export async function saveUpload(buffer: Buffer): Promise<{ relativePath: string; mimeType: string }> {
  if (buffer.length === 0) throw new UploadValidationError("Empty file");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadValidationError("File exceeds the 10MB limit");
  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    throw new UploadValidationError("Unsupported file type — only JPEG, PNG, WEBP, or HEIC images are accepted");
  }
  await mkdir(STORAGE_ROOT, { recursive: true });
  const filename = `${randomUUID()}.${sniffed.extension}`;
  await writeFile(path.join(STORAGE_ROOT, filename), buffer);
  return { relativePath: filename, mimeType: sniffed.mimeType };
}

export async function readUpload(relativePath: string): Promise<Buffer> {
  // path.basename strips any directory components — defends against path traversal even
  // though every caller should only ever pass back a value this module itself generated
  // and the DB stored; reject outright rather than silently normalizing if it differs.
  const safe = path.basename(relativePath);
  if (safe !== relativePath || safe === "" || safe === "." || safe === "..") {
    throw new UploadValidationError("Invalid file reference");
  }
  return readFile(path.join(STORAGE_ROOT, safe));
}

// Signatures are small (a few KB) and stored inline as a data URL, unlike ID photos —
// no reason to round-trip them through disk. Still capped and shape-checked since this
// too is a public write path.
const MAX_SIGNATURE_DATA_URL_LENGTH = 280_000; // ~200KB decoded, base64 overhead ~4/3
const SIGNATURE_DATA_URL_PREFIX = "data:image/png;base64,";

export function isValidSignatureDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(SIGNATURE_DATA_URL_PREFIX) &&
    value.length > SIGNATURE_DATA_URL_PREFIX.length &&
    value.length <= MAX_SIGNATURE_DATA_URL_LENGTH
  );
}
