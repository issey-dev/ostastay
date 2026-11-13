import { NextResponse } from "next/server";
import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { nextConfirmationVersion } from "@/lib/agent-api/bookings";
import { buildConfirmationPdf } from "@/lib/agent-api/confirmation-pdf";
import { sendEnterpriseMail, MAIL_KINDS } from "@/lib/mail-sender";
import { prisma } from "@/lib/db";

// POST /bookings/{ref}/confirmation  { showPrice?: boolean, email?: boolean }
//   Generates the booking confirmation (or, while tentative, the option confirmation) as a new
//   version, emails it to the agent's own address, and returns it as a PDF. Never sent to the
//   agent's client by the hotel (owner, 2026-11-11).
export const POST = agentRoute<{ ref: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request).catch(() => ({} as Record<string, unknown>));
  const r = await nextConfirmationVersion(agent, ctx.propertyIds, ctx.params.ref);
  let price: number | null = null;
  if (body.showPrice === true) {
    const lines = await prisma.folioLineItem.aggregate({ where: { folio: { reservationId: r.id }, isVoid: false }, _sum: { amount: true, taxAmount: true, serviceChargeAmount: true } });
    const posted = (lines._sum.amount ?? 0) + (lines._sum.taxAmount ?? 0) + (lines._sum.serviceChargeAmount ?? 0);
    price = posted > 0 ? posted : null;
  }
  const pdf = await buildConfirmationPdf(r, { showPrice: body.showPrice === true, sourceName: agent.sourceName, price });
  const filename = `${r.status === "TENTATIVE" ? "Option" : "Confirmation"}-${r.agentRef}-v${r.agentConfirmationVersion}.pdf`;
  if (body.email !== false) {
    await sendEnterpriseMail({
      enterpriseId: agent.enterpriseId,
      kind: MAIL_KINDS.AGENT_PORTAL,
      to: agent.email,
      subject: `${r.status === "TENTATIVE" ? "Option" : "Booking confirmation"} ${r.agentRef} (version ${r.agentConfirmationVersion})`,
      text: `Attached: ${filename}`,
      html: `<p>Attached: ${filename}</p>`,
      attachments: [{ filename, content: Buffer.from(pdf), contentType: "application/pdf" }],
    } as Parameters<typeof sendEnterpriseMail>[0]).catch((e) => console.error("[agent-api] confirmation mail failed", e));
  }
  if ((ctx.request.headers.get("accept") ?? "").includes("application/json")) {
    return apiJson({ filename, version: r.agentConfirmationVersion, pdfBase64: Buffer.from(pdf).toString("base64") });
  }
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
});
