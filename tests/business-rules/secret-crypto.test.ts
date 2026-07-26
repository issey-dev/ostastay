import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncryptedSecret } from "@/lib/secret-crypto";

// S8: SMTP/SFTP passwords are encrypted at rest with AES-256-GCM keyed on
// SECRETS_ENCRYPTION_KEY. getKey() reads the env at call time, so tests toggle it freely.
const KEY = "test-secrets-key-for-vitest";

describe("secret-crypto (S8) — encryption at rest", () => {
  afterEach(() => { delete process.env.SECRETS_ENCRYPTION_KEY; });

  it("round-trips a secret and the ciphertext is not the plaintext", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const plain = "hunter2-smtp-password";
    const enc = encryptSecret(plain)!;
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(enc).not.toContain(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("uses a fresh IV each time (same plaintext -> different ciphertext)", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const a = encryptSecret("same")!;
    const b = encryptSecret("same")!;
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("reads legacy plaintext transparently (backward compatible)", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    // A value stored before encryption existed has no prefix — returned as-is.
    expect(isEncryptedSecret("plain-legacy-pw")).toBe(false);
    expect(decryptSecret("plain-legacy-pw")).toBe("plain-legacy-pw");
  });

  it("is a no-op when no key is configured (stores plaintext, as before)", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(encryptSecret("nokey-pw")).toBe("nokey-pw");
    expect(decryptSecret("nokey-pw")).toBe("nokey-pw");
  });

  it("does not double-encrypt an already-encrypted value", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const once = encryptSecret("secret")!;
    expect(encryptSecret(once)).toBe(once);
  });

  it("passes null/empty through unchanged", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    expect(encryptSecret(null)).toBe(null);
    expect(encryptSecret("")).toBe(null);
    expect(decryptSecret(null)).toBe(null);
  });

  it("throws if an encrypted value is read with no key available", () => {
    process.env.SECRETS_ENCRYPTION_KEY = KEY;
    const enc = encryptSecret("secret")!;
    delete process.env.SECRETS_ENCRYPTION_KEY;
    expect(() => decryptSecret(enc)).toThrow();
  });
});
