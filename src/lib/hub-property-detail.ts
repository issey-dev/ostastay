import { prisma } from "@/lib/db"
import type { HubPropertyDetail } from "@/components/hub/property-detail"

// Server half of HubPropertyDetail: the fields a Hub property setup page hands its
// screens. The page's layout has already checked the user may set this property up.
export async function loadHubPropertyDetail(propertyId: string): Promise<HubPropertyDetail | null> {
  return prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
      code: true,
      bannerColor: true,
      stationeryFont: true,
      allocationCalculationMode: true,
      sessionIdleMinutes: true,
    },
  })
}
