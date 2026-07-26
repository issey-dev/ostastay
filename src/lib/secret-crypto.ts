import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Encryption-at-rest for tenant secrets (SMTP/SFTP passwords). Uses AES-256-GCM with a key
// derived from the SECRETS_ENCRYPTION_KEY environment variable. Stored values are
// self-describing (prefixed `enc:v1:`) so reads transparently handle BOTH encrypted values
// and legacy plaintext already in the DB — no data migration required.
//
// Key handling:
//   - If SECRETS_ENCRYPTION_KEY is set, new writes are encrypted; the operator's key can be
//     any string (it's hashed to a 32-byte key).
//   - If it is NOT set, encryptSecret is a no-op (stores plaintext, the pre-existing
//     behavior) so the app keeps working; decryptSecret of a legacy plaintext value is also
//     a no-op. It's only an error to READ an ENCRYPTED value with no key — which can't
//     happen unless the key was set, values encrypted, then the key removed.

const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw || raw.length === 0) return null;
  // Accept any-length operator key material; derive a fixed 32-byte AES key from it.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

// Encrypt a plaintext secret for storage. Null/empty and already-encrypted values pass
// through unchanged; without a configured key, returns the plaintext (legacy behavior).
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  if (isEncryptedSecret(plaintext)) return plaintext;
  const key = getKey();
  if (!key) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

// Decrypt a stored secret for use. Legacy plaintext (no prefix) passes through unchanged.
// Throws only if an encrypted value is present but the key is unavailable.
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return null;
  if (!isEncryptedSecret(stored)) return stored;
  const key = getKey();
  if (!key) {
    throw new Error("SECRETS_ENCRYPTION_KEY is not set, but an encrypted secret was found — cannot decrypt.");
  }
  const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
