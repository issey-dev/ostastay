import { CRIMSON_OS, DEEP_MAROON, PRODUCT_NAME } from "@/lib/brand"

// HTML bodies for PLATFORM mail — the messages that come from Uppsolut Stay itself rather
// than from a hotel (see the two-sender note in src/lib/mailer.ts).
//
// Table-based layout with inline styles throughout, and no <style> block: Gmail and
// Outlook strip stylesheets and support little modern CSS, so anything that must survive
// has to be an inline attribute on the element itself. This deliberately shares no markup
// with the app's Tailwind components — the same reasoning as the tenant confirmation
// letter in the send-confirmation route.
//
// Every message ships a plaintext alternative alongside the HTML. HTML-only mail scores
// noticeably worse with spam filters, and these are exactly the messages that must not
// land in a junk folder.

/**
 * Escape a value for interpolation into HTML.
 *
 * Not optional here: enterprise names, people's names and channel-manager error strings
 * all reach these templates from outside, and an unescaped `&` or `<` in a hotel's name is
 * enough to corrupt the markup even before anything malicious is considered.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** This deployment's public base URL, matching the convention used by the eRegistration links. */
export function appBaseUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")
}

export type BuiltEmail = { subject: string; html: string; text: string }

/**
 * The shared chrome for platform mail: crimson header bar, white content card, muted
 * footer. `bodyHtml` is trusted markup assembled by the builders below — callers must have
 * escaped anything that came from outside before it gets here.
 */
function layout(params: { title: string; bodyHtml: string; footerNote?: string }): string {
  const { title, bodyHtml, footerNote } = params
  return `
<div style="background-color: #f4f6f8; padding: 24px 0; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
    <tr>
      <td style="background-color: ${DEEP_MAROON}; padding: 20px 28px;">
        <div style="color: #ffffff; font-size: 18px; font-weight: bold; letter-spacing: 0.3px;">${escapeHtml(PRODUCT_NAME)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 28px;">
        <h1 style="margin: 0 0 18px; font-size: 19px; line-height: 1.3; color: #0d0f11;">${escapeHtml(title)}</h1>
        ${bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="border-top: 1px solid #e5e7eb; padding: 16px 28px; font-size: 12px; line-height: 1.5; color: #6b7280;">
        ${footerNote ? `${escapeHtml(footerNote)}<br/><br/>` : ""}
        This is an automated message from ${escapeHtml(PRODUCT_NAME)}. Please do not reply to it.
      </td>
    </tr>
  </table>
</div>`.trim()
}

/** A label/value row for the detail blocks below. */
function row(label: string, value: string, mono = false): string {
  return `<tr>
    <td style="padding: 7px 0; color: #6b7280; font-size: 14px; width: 40%; vertical-align: top;">${escapeHtml(label)}</td>
    <td style="padding: 7px 0; font-size: 14px; font-weight: bold; color: #0d0f11;${mono ? " font-family: Consolas, Monaco, monospace;" : ""}">${escapeHtml(value)}</td>
  </tr>`
}

/**
 * The enterprise handover email — the client's first contact with the product.
 *
 * Carries the generated password because that is what the handover flow produces: the
 * account is created BY the operator, so there is no "reset your password" path the client
 * could start from, and the password is single-use in practice (mustChangePassword makes
 * login refuse to mint a session until it is replaced). Sending it and showing it on the
 * operator's screen are both kept — mail can silently fail, and the operator needs a
 * fallback they can read out.
 */
export function buildEnterpriseWelcomeEmail(params: {
  firstName: string
  email: string
  password: string
  enterpriseName: string
  enterpriseSlug: string
}): BuiltEmail {
  const { firstName, email, password, enterpriseName, enterpriseSlug } = params
  const loginUrl = `${appBaseUrl()}/login`

  const bodyHtml = `
    <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #374151;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #374151;">
      Your ${escapeHtml(PRODUCT_NAME)} account for <strong>${escapeHtml(enterpriseName)}</strong> is ready.
      Use the details below to sign in for the first time.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 14px; margin: 0 0 20px;">
      ${row("Sign-in address", loginUrl)}
      ${row("Enterprise code", enterpriseSlug, true)}
      ${row("Email", email, true)}
      ${row("Temporary password", password, true)}
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 20px;">
      <tr><td style="background-color: ${CRIMSON_OS}; border-radius: 5px;">
        <a href="${loginUrl}" style="display: inline-block; padding: 11px 22px; color: #ffffff; font-size: 14px; font-weight: bold; text-decoration: none;">Sign in to ${escapeHtml(PRODUCT_NAME)}</a>
      </td></tr>
    </table>

    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #374151;">
      <strong>The password above is temporary.</strong> You will be asked to replace it with your own
      the first time you sign in — nothing else in the system is available until you do.
    </p>`

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your ${PRODUCT_NAME} account for ${enterpriseName} is ready. Use the details below to sign in for the first time.`,
    ``,
    `Sign-in address:     ${loginUrl}`,
    `Enterprise code:     ${enterpriseSlug}`,
    `Email:               ${email}`,
    `Temporary password:  ${password}`,
    ``,
    `The password above is temporary. You will be asked to replace it with your own the`,
    `first time you sign in — nothing else in the system is available until you do.`,
    ``,
    `This is an automated message from ${PRODUCT_NAME}. Please do not reply to it.`,
  ].join("\n")

  return {
    subject: `Your ${PRODUCT_NAME} sign-in details — ${enterpriseName}`,
    html: layout({
      title: `Welcome to ${PRODUCT_NAME}`,
      bodyHtml,
      footerNote: "If you were not expecting this email, please contact your Uppsolut representative.",
    }),
    text,
  }
}

export type ChannelAlertConnection = {
  enterpriseName: string
  connectionName: string
  provider: string
  error: string | null
}

/**
 * The channel-manager failure alert — sent to the platform's own ops mailbox, not to the
 * tenant.
 *
 * That recipient choice follows the master-account topology: the Beds24 account belongs to
 * Uppsolut, so a credential that has lapsed is something only we can re-authorize with a
 * fresh invite code. Telling the hotel would be reporting a fault they have no way to fix.
 */
export function buildChannelAlertEmail(params: { connections: ChannelAlertConnection[] }): BuiltEmail {
  const { connections } = params
  const count = connections.length
  const plural = count === 1 ? "connection" : "connections"

  const rows = connections
    .map(
      (c) => `<tr>
        <td style="padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #0d0f11;">${escapeHtml(c.enterpriseName)}</td>
        <td style="padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #0d0f11;">${escapeHtml(c.connectionName)}</td>
        <td style="padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280;">${escapeHtml(c.provider)}</td>
        <td style="padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #b91c1c;">${escapeHtml(c.error ?? "Unknown error")}</td>
      </tr>`
    )
    .join("\n")

  const bodyHtml = `
    <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #374151;">
      The scheduled keep-alive could not refresh ${count} channel-manager ${plural}. Until this is
      resolved, availability and rates will stop publishing and inbound bookings may be missed.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
      <tr>
        <th align="left" style="padding: 8px 10px; background-color: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280;">Enterprise</th>
        <th align="left" style="padding: 8px 10px; background-color: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280;">Connection</th>
        <th align="left" style="padding: 8px 10px; background-color: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280;">Provider</th>
        <th align="left" style="padding: 8px 10px; background-color: #f3f4f6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #6b7280;">Last error</th>
      </tr>
      ${rows}
    </table>

    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #374151;">
      A Beds24 refresh token dies after 30 days unused and cannot be revived — recovering one
      needs a fresh invite code entered against the connection in the platform console.
    </p>`

  const text = [
    `${count} channel-manager ${plural} failed the scheduled keep-alive.`,
    ``,
    `Until this is resolved, availability and rates will stop publishing and inbound`,
    `bookings may be missed.`,
    ``,
    ...connections.map(
      (c) => `- ${c.enterpriseName} / ${c.connectionName} (${c.provider}): ${c.error ?? "Unknown error"}`
    ),
    ``,
    `A Beds24 refresh token dies after 30 days unused and cannot be revived — recovering`,
    `one needs a fresh invite code entered against the connection in the platform console.`,
  ].join("\n")

  return {
    subject: `[${PRODUCT_NAME}] ${count} channel ${plural} failing`,
    html: layout({ title: `Channel manager: ${count} ${plural} failing`, bodyHtml }),
    text,
  }
}

/** The message behind the "Send test email" buttons — proves an end-to-end delivery, not just auth. */
export function buildSmtpTestEmail(params: { sender: string }): BuiltEmail {
  const bodyHtml = `
    <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #374151;">
      This is a test message from ${escapeHtml(params.sender)}.
    </p>
    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #374151;">
      Receiving it confirms the full path works: the credentials authenticate, the sending
      domain is accepted by the provider, and mail reaches this address.
    </p>`

  return {
    subject: `${PRODUCT_NAME} — SMTP test`,
    html: layout({ title: "SMTP test message", bodyHtml }),
    text: [
      `This is a test message from ${params.sender}.`,
      ``,
      `Receiving it confirms the full path works: the credentials authenticate, the sending`,
      `domain is accepted by the provider, and mail reaches this address.`,
    ].join("\n"),
  }
}
