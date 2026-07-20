// HISTORICAL — run once during the Profiles redesign (see DECISIONS.md "Profiles
// redesign"). Must run AFTER migration 20260720140000_profile_communications_addresses
// (adds ProfileCommunication/ProfileAddress, ProfileContact still present) and BEFORE
// 20260720150000_drop_profile_contact — the only window where both the old and new
// shapes coexist, so ProfileContact's mixed contact+address rows can be split forward
// into the new focused models instead of silently lost.
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const contacts = await (prisma as any).profileContact.findMany()
  let commsCreated = 0
  let addressesCreated = 0

  for (const c of contacts) {
    if (c.email) {
      await prisma.profileCommunication.create({
        data: { upid: c.upid, type: "EMAIL", value: c.email, isPrimary: c.isPrimary },
      })
      commsCreated++
    }
    if (c.mobile) {
      await prisma.profileCommunication.create({
        data: { upid: c.upid, type: "MOBILE", value: c.mobile, isPrimary: c.isPrimary && !c.email },
      })
      commsCreated++
    }
    const hasAddress = c.address || c.city || c.stateProvince || c.postalCode || c.country
    if (hasAddress) {
      await prisma.profileAddress.create({
        data: {
          upid: c.upid,
          type: "HOME",
          fullAddress: c.address || "",
          city: c.city,
          stateProvince: c.stateProvince,
          postalCode: c.postalCode,
          country: c.country,
          isPrimary: c.isPrimary,
        },
      })
      addressesCreated++
    }
  }

  console.log(`Backfilled ${commsCreated} communication(s) and ${addressesCreated} address(es) from ${contacts.length} ProfileContact row(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
