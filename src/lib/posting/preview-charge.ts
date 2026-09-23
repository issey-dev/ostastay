import { prisma } from "@/lib/db";
import { postCharge, type PostChargeInput } from "@/lib/posting/post-charge";

// What a charge WOULD post, computed by postCharge itself.
//
// A quote the guest is shown must equal what the booking then posts, to the cent. Rather
// than a second implementation of the tax engine that could drift from postCharge (outlet
// tax override, charge-code tax profile, service charge, GST routing, per-person levies),
// this runs the real postCharge inside a transaction against a scratch folio and ALWAYS
// rolls it back. Nothing is ever committed; the only cost is a few writes that never land.

export type ChargePreviewLine = { description: string; amount: number };

export type ChargePreview = {
  /** Pre-tax base of the charge. */
  baseAmount: number;
  serviceCharge: number;
  tax: number;
  /** Generated levies/fees (e.g. a per-person green tax) — not the charge's own tax. */
  levies: number;
  grandTotal: number;
  /** Every line the posting produces, as the folio would show them. */
  lines: ChargePreviewLine[];
};

class Rollback extends Error {
  constructor(public readonly preview: ChargePreview) {
    super("preview rollback");
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function previewCharge(
  propertyId: string,
  input: Omit<PostChargeInput, "folioId" | "shiftId" | "outletCheckId" | "roomAssignmentId">
): Promise<ChargePreview> {
  try {
    await prisma.$transaction(async (tx) => {
      const folio = await tx.folio.create({ data: { propertyId, folioNumber: 1, walkInGuestName: "Quote" } });
      const posted = await postCharge(tx, { ...input, folioId: folio.id });
      const all = [posted.parent, ...posted.generated];
      // The charge's OWN service charge and tax: the parent's columns plus the lines they
      // were routed onto (routed tax lines carry no base amount). A levy's own tax is
      // already inside posted.leviesTotal and must not be counted again here.
      const own = [posted.parent, ...posted.generated.filter((l) => l.amount === 0)];
      const serviceCharge = round2(own.reduce((s, l) => s + l.serviceChargeAmount, 0));
      const tax = round2(own.reduce((s, l) => s + l.taxAmount, 0));
      throw new Rollback({
        baseAmount: posted.baseAmount,
        serviceCharge,
        tax,
        levies: posted.leviesTotal,
        grandTotal: posted.grandTotal,
        lines: all.map((l) => ({
          description: l.description,
          amount: round2(l.amount + l.taxAmount + l.serviceChargeAmount),
        })),
      });
    });
  } catch (e) {
    if (e instanceof Rollback) return e.preview;
    throw e;
  }
  throw new Error("previewCharge: transaction committed unexpectedly");
}
