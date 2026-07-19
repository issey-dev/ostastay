import nodemailer from "nodemailer"
import type { EnterpriseSettings } from "@prisma/client"

// Shared SMTP-sending helper — the one place that turns EnterpriseSettings.smtp*
// scaffold fields into an actual outgoing email. Every route that sends mail (starting
// with the reservation Confirmation Letter) should go through this rather than
// constructing its own transport, so SMTP behavior stays consistent in one place.
//
// SECURITY NOTE: EnterpriseSettings.smtpPassword is stored in plain text today (see the
// schema comment on EnterpriseSettings) — this function reads it server-side only and
// never re-exposes it to the client, but the at-rest storage itself is not encrypted.
// Treat this as a known follow-up, not something this function can fix on its own.

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
    auth: { user: smtpUsername, pass: smtpPassword },
  })

  await transporter.sendMail({
    from: smtpFromAddress,
    to: params.to,
    subject: params.subject,
    html: params.html,
  })
}
