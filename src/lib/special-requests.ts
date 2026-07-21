import { prisma } from "@/lib/db";

// Shared by the reservation POST and PUT routes: normalizes and validates a
// specialRequestCodes[] payload against the enterprise's SPECIAL_REQUEST SystemCode
// LOV (Controls > Reservations > Reservation Dropdown Lists). Returns the deduped
// code list, or an error string when any code isn't a real active option.
export async function validateSpecialRequestCodes(
  enterpriseId: string,
  input: unknown
): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  if (input == null) return { ok: true, codes: [] };
  if (!Array.isArray(input) || input.some((c) => typeof c !== "string")) {
    return { ok: false, error: "specialRequestCodes must be an array of codes" };
  }
  const codes = [...new Set(input as string[])];
  if (codes.length === 0) return { ok: true, codes };

  const valid = await prisma.systemCode.findMany({
    where: { enterpriseId, category: "SPECIAL_REQUEST", code: { in: codes }, isActive: true },
    select: { code: true },
  });
  if (valid.length !== codes.length) {
    return { ok: false, error: "One or more special requests are not configured options" };
  }
  return { ok: true, codes };
}
