import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Test helper: set a property's own settings (PropertySettings) — tax switches and rates,
// posting defaults, module outlets, document content. These were EnterpriseSettings
// columns until 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md).
//
// An UPSERT, because seeding a property's chart (ensureChart / ensureChargeTree) already
// creates the row to record its posting defaults.
export async function setPropertySettings(
  propertyId: string,
  data: Omit<Prisma.PropertySettingsUncheckedCreateInput, "propertyId">
) {
  return prisma.propertySettings.upsert({
    where: { propertyId },
    update: data,
    create: { propertyId, ...data },
  });
}
