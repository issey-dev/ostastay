import { prisma } from "@/lib/db"
import { hasPermission } from "@/lib/scope"
import { propertyPage } from "@/lib/hub-page"
import { resolveBusinessDate } from "@/lib/business-date"
import { getPropertySettings } from "@/lib/property-settings"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { BusinessDateManager } from "@/components/hub/business-date-manager"
import { NightlyPostingsManager, EodRoomStatusManager, NoShowManager, DeparturesManager } from "@/components/hub/night-audit-settings"
import { ScheduledAuditManager } from "@/components/hub/scheduled-audit-manager"

// This property's Night Audit controls (owner, 2026-09-23): its business date (moved by hand
// only under the rules in src/lib/business-date-change.ts), which Maldives levies are posted
// each night (their rates stay under Finance), and what happens to vacant rooms' status.
export default async function HubPropertyNightAuditPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { ctx, property, item, canEdit } = await propertyPage(params, "night-audit")
  const [row, settings] = await Promise.all([
    prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: { businessDate: true, timeZone: true, eodHousekeepingMode: true, eodHousekeepingTargetStatus: true },
    }),
    getPropertySettings(property.id),
  ])
  const lastRun = await prisma.eodRun.findFirst({
    where: { propertyId: property.id, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { businessDate: true, completedAt: true },
  })
  const lastAudit = lastRun?.completedAt
    ? `${lastRun.businessDate.toISOString().slice(0, 10)} (finished ${lastRun.completedAt.toISOString().slice(0, 16).replace("T", " ")} UTC)`
    : null
  const editable = canEdit("update")

  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard
        title="Business Date"
        description="The property's working day. Night Audit moves it forward one day at a time; it can be moved by hand only when nothing would be skipped over — or to any date while the property has no activity at all."
      >
        <BusinessDateManager
          propertyId={property.id}
          current={resolveBusinessDate(row).toISOString().slice(0, 10)}
          canChange={editable && hasPermission(ctx, "NIGHT_AUDIT", "update")}
        />
      </ControlsCard>
      <ControlsCard
        title="Nightly Tax Postings"
        description="Which Maldives levies Night Audit calculates and posts each night. Their rates and amounts are set under Finance."
      >
        <NightlyPostingsManager
          propertyId={property.id}
          canEdit={editable}
          initial={{ greenTaxEnabled: settings.greenTaxEnabled, tgstEnabled: settings.tgstEnabled, serviceChargeEnabled: settings.serviceChargeEnabled }}
        />
      </ControlsCard>
      <ControlsCard title="Departures" description="What Night Audit does with guests still due out when it runs.">
        <DeparturesManager propertyId={property.id} canEdit={editable} initial={settings.autoCheckOutZeroBalance} />
      </ControlsCard>
      <ControlsCard title="No-Shows" description="When Night Audit marks a reservation that never arrived as a No-Show, and whether it posts the no-show fee.">
        <NoShowManager
          propertyId={property.id}
          canEdit={editable}
          initialTiming={settings.noShowTiming}
          initialPostFee={settings.noShowPostFee}
        />
      </ControlsCard>
      <ControlsCard title="Scheduled Night Audit" description="Run this property's End-of-Day automatically at a set time each night.">
        <ScheduledAuditManager
          propertyId={property.id}
          timeZone={row.timeZone || "UTC"}
          canEdit={editable}
          lastAudit={lastAudit}
          noShowTiming={settings.noShowTiming}
          initial={{ autoAuditEnabled: settings.autoAuditEnabled, autoAuditTime: settings.autoAuditTime }}
        />
      </ControlsCard>
      <ControlsCard title="Room Status at Night Audit" description="What Night Audit does to vacant rooms' housekeeping status when it runs.">
        <EodRoomStatusManager
          propertyId={property.id}
          canEdit={editable}
          initialMode={row.eodHousekeepingMode}
          initialTarget={row.eodHousekeepingTargetStatus}
        />
      </ControlsCard>
    </div>
  )
}
