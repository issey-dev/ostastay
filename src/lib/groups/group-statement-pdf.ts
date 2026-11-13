import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { DEEP_MAROON, OBSIDIAN_BLACK, STEEL_SLATE } from "@/lib/brand";

// The group's documents in one PDF (Agent Portal plan §7, Phase 8: "Send documents" in the
// Master folio section). One statement: the block, then the master folio and every pickup's
// folio with its lines, payments and balance, and the group total. Group blocks could not send
// folios in bulk before; this is the one document a group organiser or agent asks for.

function hex(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const money = (n: number) => n.toFixed(2);

export async function buildGroupStatementPdf(groupBlockId: string): Promise<{ pdf: Uint8Array; filename: string; total: number; balance: number }> {
  const block = await prisma.groupBlock.findUniqueOrThrow({
    where: { id: groupBlockId },
    include: {
      property: { select: { name: true, defaultCurrency: true } },
      masterFolios: { include: { lineItems: { where: { isVoid: false } }, payments: true } },
      reservations: {
        where: { status: { notIn: ["CANCELLED"] }, isPostingMaster: false },
        orderBy: { confirmationNo: "asc" },
        include: { primaryGuest: { select: { firstName: true, lastName: true } }, folios: { include: { lineItems: { where: { isVoid: false } }, payments: true } } },
      },
    },
  });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([595.28, 841.89]);
  let y = 790;
  const line = (s: string, x: number, size = 9, f: PDFFont = font, color = hex(OBSIDIAN_BLACK)) => {
    if (y < 60) {
      page = doc.addPage([595.28, 841.89]);
      y = 790;
    }
    page.drawText(s.slice(0, 95), { x, y, size, font: f, color });
  };
  const right = (s: string, xRight: number, size = 9, f: PDFFont = font) => {
    const w = f.widthOfTextAtSize(s, size);
    page.drawText(s, { x: xRight - w, y, size, font: f, color: hex(OBSIDIAN_BLACK) });
  };

  line(block.property.name, 50, 18, bold, hex(DEEP_MAROON));
  y -= 22;
  line(`Group statement: ${block.name} (${block.code})`, 50, 12, bold);
  y -= 14;
  line(`${block.startDate.toISOString().slice(0, 10)} to ${block.endDate.toISOString().slice(0, 10)} · ${block.property.defaultCurrency}`, 50, 9, font, hex(STEEL_SLATE));
  y -= 20;

  let grandCharges = 0;
  let grandPaid = 0;
  const folioBlock = (title: string, folios: { folioNumber: number; lineItems: { date: Date; description: string; amount: number; taxAmount: number; serviceChargeAmount: number }[]; payments: { amount: number; isRefund: boolean }[] }[]) => {
    const lines = folios.flatMap((f) => f.lineItems);
    const pays = folios.flatMap((f) => f.payments);
    if (lines.length === 0 && pays.length === 0) return;
    line(title, 50, 10, bold);
    y -= 14;
    let charges = 0;
    for (const l of lines.sort((a, b) => a.date.getTime() - b.date.getTime())) {
      const gross = l.amount + l.taxAmount + l.serviceChargeAmount;
      charges += gross;
      line(l.date.toISOString().slice(0, 10), 60);
      line(l.description, 130);
      right(money(gross), 545);
      y -= 12;
    }
    const paid = pays.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0);
    line("Charges", 130, 9, bold);
    right(money(charges), 545, 9, bold);
    y -= 12;
    if (paid) {
      line("Payments", 130);
      right(money(-paid), 545);
      y -= 12;
    }
    line("Balance", 130, 9, bold);
    right(money(charges - paid), 545, 9, bold);
    y -= 18;
    grandCharges += charges;
    grandPaid += paid;
  };

  folioBlock("Master folio", block.masterFolios);
  for (const r of block.reservations) {
    folioBlock(`${r.confirmationNo} · ${r.primaryGuest.firstName} ${r.primaryGuest.lastName ?? ""}`.trim(), r.folios);
  }
  y -= 6;
  page.drawLine({ start: { x: 50, y: y + 8 }, end: { x: 545, y: y + 8 }, thickness: 1, color: hex(STEEL_SLATE) });
  line("Group total", 50, 11, bold);
  right(money(grandCharges), 545, 11, bold);
  y -= 14;
  line("Paid", 50, 10);
  right(money(grandPaid), 545, 10);
  y -= 14;
  line("Balance due", 50, 11, bold);
  right(money(grandCharges - grandPaid), 545, 11, bold);

  return {
    pdf: await doc.save(),
    filename: `Group-${block.code}-statement.pdf`,
    total: Math.round(grandCharges * 100) / 100,
    balance: Math.round((grandCharges - grandPaid) * 100) / 100,
  };
}
