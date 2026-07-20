// The one place the JWT signing secret is resolved. Production fails CLOSED: if
// JWT_SECRET is unset the module throws at import time (i.e. at boot), rather than
// silently falling back to a well-known string that would let anyone forge a session
// cookie. The fallback below exists only for local dev/test convenience.
const FALLBACK_DEV_SECRET =
  "default_super_secret_jwt_key_that_should_be_changed_in_prod";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start in production with the built-in development fallback secret — set the JWT_SECRET environment variable."
    );
  }
  return FALLBACK_DEV_SECRET;
}

export const JWT_SECRET = new TextEncoder().encode(resolveJwtSecret());
