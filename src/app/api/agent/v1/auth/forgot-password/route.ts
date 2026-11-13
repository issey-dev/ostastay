import { agentRoute, apiJson, jsonBody } from "@/lib/agent-api/http";
import { forgotPassword, portalLink } from "@/lib/agent-api/auth";
import { consumeRateLimit } from "@/lib/website-api/rate-limit";
import { sendEnterpriseMail, MAIL_KINDS } from "@/lib/mail-sender";

// POST /api/agent/v1/auth/forgot-password  { email } → always 202: whether the email exists
// is never revealed. The reset link is emailed when the portal address and mail are set up.
export const POST = agentRoute(
  async ({ request, key, ip }) => {
    const body = await jsonBody(request);
    const d = await consumeRateLimit("agentLogin", `ip:${ip ?? "unknown"}`);
    if (d.allowed) {
      const r = await forgotPassword(key.enterpriseId, body.email);
      const link = r ? portalLink("reset-password", r.token) : null;
      if (r && link) {
        await sendEnterpriseMail({
          enterpriseId: key.enterpriseId,
          kind: MAIL_KINDS.AGENT_PORTAL,
          to: r.to,
          subject: "Reset your agent portal password",
          text: `Use this link within two hours to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
          html: `<p>Use this link within two hours to choose a new password:</p><p><a href="${link}">${link}</a></p><p>If you did not ask for this, ignore this email.</p>`,
        }).catch((e) => console.error("[agent-api] reset mail failed", e));
      }
    }
    return apiJson({ ok: true }, { status: 202 });
  },
  { auth: false }
);
