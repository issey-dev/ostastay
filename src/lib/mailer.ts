import nodemailer from "nodemailer"
import type { EnterpriseSettings } from "@prisma/client"
import { decryptSecret } from "@/lib/secret-crypto"

// Shared SMTP-sending helper — the one place that turns EnterpriseSettings.smtp*
// scaffold fields into an actual outgoing email. Every route that sends mail (starting
// with the reservation Confirmation Letter) should go through this rather than
// constructing its own transport, so SMTP behavior stays consistent in one place.
//
// SECURITY: EnterpriseSettings.smtpPassword is encrypted at rest (AES-256-GCM, see
// src/lib/secret-crypto.ts) when SECRETS_ENCRYPTION_KEY is configured; legacy plaintext
// values still read transparently. This function decrypts it server-side only at send
// time and never re-exposes it to the client.

export type SmtpConfig = Pick<
  EnterpriseSettings,
  "smtpHost" | "smtpPort" | "smtpUsername" | "smtpPassword" | "smtpFromAddress" | "smtpUseTls"
>

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super("SMTP is not configured for this enterprise — set it up under Controls → Reports → SMTP/SFTP first.")
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

export async function sendMail(params: {
  settings: SmtpConfig
  to: string
  subject: string
  html: string
}): Promise<void> {
  assertSmtpConfigured(params.settings)
  const { smtpHost, smtpPort, smtpUsername, smtpPassword, smtpFromAddress, smtpUseTls } = params.settings

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    // Port 465 is implicit TLS; anything else (e.g. 587) uses STARTTLS, gated by the
    // smtpUseTls toggle — this mirrors how most SMTP providers actually expect the two
    // to be distinguished, rather than treating "TLS on" as always meaning port 465.
    secure: smtpPort === 465,
    requireTLS: smtpPort !== 465 && smtpUseTls,
    // Decrypt at send time (no-op for legacy plaintext); the plaintext never leaves here.
    auth: { user: smtpUsername, pass: decryptSecret(smtpPassword) ?? undefined },
  })

  await transporter.sendMail({
    from: smtpFromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
  })
}
