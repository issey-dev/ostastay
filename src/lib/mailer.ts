import nodemailer, { type Transporter } from "nodemailer"
import type { EnterpriseSettings } from "@prisma/client"
import { decryptSecret } from "@/lib/secret-crypto"

// The one place that turns SMTP configuration into an actual outgoing email. Every route
// or job that sends mail goes through this rather than constructing its own transport, so
// SMTP behavior stays consistent in one place.
//
// There are TWO senders, deliberately kept apart:
//
//   TENANT  (sendMail)         — the customer's OWN SMTP, from EnterpriseSettings.smtp*.
//                                Guest-facing mail: confirmation letters, eRegistration
//                                links, debtor statements. It must come from the hotel's
//                                own domain, so this is per-enterprise and configured by
//                                the tenant under Controls → Reports → SMTP / SFTP.
//
//   PLATFORM (sendPlatformMail) — Uppsolut Stay's own SMTP, from environment variables.
//                                Mail that is FROM US, not from a hotel: enterprise
//                                handover credentials and channel-manager alerts. There is
//                                no tenant to read config from at that point (a brand-new
//                                enterprise has no settings row and no domain of its own),
//                                which is exactly why this side is env-configured.
//
// SECURITY: EnterpriseSettings.smtpPassword is encrypted at rest (AES-256-GCM, see
// src/lib/secret-crypto.ts) when SECRETS_ENCRYPTION_KEY is configured; legacy plaintext
// values still read transparently. It is decrypted server-side only at send time and never
// re-exposed to the client. The platform password comes from the environment and is never
// stored in the database at all.

export type SmtpConfig = Pick<
  EnterpriseSettings,
  "smtpHost" | "smtpPort" | "smtpUsername" | "smtpPassword" | "smtpFromAddress" | "smtpUseTls"
>

/** A fully-resolved, ready-to-use SMTP account — either a tenant's or the platform's. */
export type ResolvedSmtp = {
  host: string
  port: number
  username: string
  /** Plaintext at this point: tenant values are already decrypted, platform values come from env. */
  password: string
  fromAddress: string
  /** Optional display name, e.g. "Uppsolut Stay <noreply@…>". */
  fromName?: string
  useTls: boolean
}

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is not configured for this enterprise — set it up under Controls → Reports → SMTP / SFTP first.")
  }
}

export class PlatformSmtpNotConfiguredError extends Error {
  constructor() {
    super(
      "Platform SMTP is not configured — set PLATFORM_SMTP_HOST, PLATFORM_SMTP_USERNAME, " +
        "PLATFORM_SMTP_PASSWORD and PLATFORM_SMTP_FROM_ADDRESS in the environment."
    )
  }
}

function isConfigured(settings: SmtpConfig | null): settings is SmtpConfig & {
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpFromAddress: string
} {
  return !!(
    settings &&
    settings.smtpHost &&
    settings.smtpPort &&
    settings.smtpUsername &&
    settings.smtpPassword &&
    settings.smtpFromAddress
  )
}

// Kept as a separate export (rather than inlined into sendMail) so a route can check
// configuration up front and return a clean 400 before doing any other work.
export function assertSmtpConfigured(settings: SmtpConfig | null): asserts settings is SmtpConfig & {
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpFromAddress: string
} {
  if (!isConfigured(settings)) {
    throw new SmtpNotConfiguredError()
  }
}

/**
 * Whether a tenant has enough SMTP settings saved to send anything. Never throws.
 *
 * Generic over the settings type so narrowing a full EnterpriseSettings row keeps the rest
 * of its fields — callers routinely need `invoiceBrandName` or `id` from the same object.
 */
export function isTenantSmtpConfigured<T extends SmtpConfig>(
  settings: T | null
): settings is T & {
  smtpHost: string
  smtpPort: number
  smtpUsername: string
  smtpPassword: string
  smtpFromAddress: string
} {
  return isConfigured(settings)
}

/** Turn stored tenant settings into a resolved account, decrypting the password. */
export function resolveTenantSmtp(settings: SmtpConfig | null): ResolvedSmtp {
  assertSmtpConfigured(settings)
  return {
    host: settings.smtpHost,
    port: settings.smtpPort,
    username: settings.smtpUsername,
    // Decrypt at point of use (no-op for legacy plaintext); the plaintext never leaves here.
    password: decryptSecret(settings.smtpPassword) ?? "",
    fromAddress: settings.smtpFromAddress,
    useTls: settings.smtpUseTls,
  }
}

function buildTransport(smtp: ResolvedSmtp): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // Port 465 is implicit TLS; anything else (e.g. 587) uses STARTTLS, gated by the
    // useTls toggle — this mirrors how most SMTP providers actually expect the two
    // to be distinguished, rather than treating "TLS on" as always meaning port 465.
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465 && smtp.useTls,
    auth: { user: smtp.username, pass: smtp.password },
    // Bounded waits. Without these a wedged SMTP host hangs the caller indefinitely —
    // tolerable in a request, but a cron job that never returns stops every later job in
    // the same run.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

export type MailContent = {
  to: string
  subject: string
  html: string
  /** Plaintext alternative. Worth supplying — HTML-only mail scores worse with spam filters. */
  text?: string
  replyTo?: string
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
}

async function deliver(smtp: ResolvedSmtp, mail: MailContent): Promise<void> {
  const transporter = buildTransport(smtp)
  try {
    await transporter.sendMail({
      // The object form lets nodemailer handle display-name quoting and encoding.
      from: smtp.fromName ? { name: smtp.fromName, address: smtp.fromAddress } : smtp.fromAddress,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: mail.replyTo,
      attachments: mail.attachments,
    })
  } finally {
    // Each send builds its own transport; close it so the connection is not left open.
    transporter.close()
  }
}

/**
 * Open a connection and authenticate WITHOUT sending anything.
 *
 * This is what the "Test connection" buttons call. It proves host/port/TLS/credentials are
 * right, which is the part operators actually get wrong — it cannot prove the sending
 * domain is verified or that the provider will accept the recipient, so a passing test
 * still leaves a send able to be rejected (Amazon SES in sandbox mode being the obvious
 * case). Returns the failure as a value rather than throwing: the caller is a UI, and a
 * bad password is an expected outcome here, not an exception.
 */
export async function verifySmtp(smtp: ResolvedSmtp): Promise<{ ok: true } | { ok: false; error: string }> {
  const transporter = buildTransport(smtp)
  try {
    await transporter.verify()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    transporter.close()
  }
}

/**
 * Send using the TENANT's own SMTP account — guest-facing mail from the hotel's domain.
 *
 * Throws SmtpNotConfiguredError when the enterprise has not set SMTP up, so callers can
 * return a clean 400 telling the operator where to configure it.
 */
export async function sendMail(params: { settings: SmtpConfig } & MailContent): Promise<void> {
  const { settings, ...mail } = params
  await deliver(resolveTenantSmtp(settings), mail)
}

// ---------------------------------------------------------------------------
// Platform SMTP — Uppsolut Stay's own sender
// ---------------------------------------------------------------------------

const DEFAULT_PLATFORM_PORT = 587
const DEFAULT_PLATFORM_FROM_NAME = "Uppsolut Stay"

/**
 * Read the platform SMTP account from the environment, or null when it is not set up.
 *
 * Returns null rather than throwing so callers can degrade gracefully: an unconfigured
 * platform mailer must never be what stops an enterprise from being onboarded — the
 * credentials are still shown on screen for manual handover.
 */
export function getPlatformSmtpConfig(): ResolvedSmtp | null {
  const host = process.env.PLATFORM_SMTP_HOST?.trim()
  const username = process.env.PLATFORM_SMTP_USERNAME?.trim()
  const password = process.env.PLATFORM_SMTP_PASSWORD
  const fromAddress = process.env.PLATFORM_SMTP_FROM_ADDRESS?.trim()

  if (!host || !username || !password || !fromAddress) return null

  const parsedPort = Number.parseInt(process.env.PLATFORM_SMTP_PORT ?? "", 10)
  return {
    host,
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PLATFORM_PORT,
    username,
    password,
    fromAddress,
    fromName: process.env.PLATFORM_SMTP_FROM_NAME?.trim() || DEFAULT_PLATFORM_FROM_NAME,
    // Opt OUT explicitly; anything else (including unset) keeps STARTTLS on.
    useTls: process.env.PLATFORM_SMTP_USE_TLS?.trim().toLowerCase() !== "false",
  }
}

export function isPlatformSmtpConfigured(): boolean {
  return getPlatformSmtpConfig() !== null
}

/**
 * Send as Uppsolut Stay itself — onboarding credentials, channel-manager alerts.
 *
 * Throws PlatformSmtpNotConfiguredError when the environment is not set up. Callers that
 * must not fail because of mail (onboarding) should catch it; callers that exist only to
 * send (the platform test endpoint) should surface it.
 */
export async function sendPlatformMail(mail: MailContent): Promise<void> {
  const smtp = getPlatformSmtpConfig()
  if (!smtp) throw new PlatformSmtpNotConfiguredError()
  await deliver(smtp, mail)
}

/**
 * Who receives platform operational alerts (channel-manager failures).
 *
 * Comma-separated in PLATFORM_ALERT_EMAIL. Empty means alerting is off — a deliberate
 * choice rather than an error: a deployment with no ops mailbox should run silently, not
 * log a failure on every sweep.
 */
export function getPlatformAlertRecipients(): string[] {
  return (process.env.PLATFORM_ALERT_EMAIL ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.includes("@"))
}
