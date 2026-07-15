const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const tenantId = "00000000-0000-0000-0000-000000000000"

  // Ensure tenant exists
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      name: "Demo Guest House"
    }
  })

  // Seed profiles
  const profiles = [
    {
      tenantId,
      profileType: "GUEST",
      firstName: "John",
      lastName: "Doe",
      classification: "VIP",
      preferredLanguage: "en",
    },
    {
      tenantId,
      profileType: "GUEST",
      firstName: "Jane",
      lastName: "Smith",
      classification: "REGULAR",
      preferredLanguage: "en",
    },
    {
      tenantId,
      profileType: "COMPANY",
      firstName: "Acme", // required by schema even for companies
      companyName: "Acme Corp",
      classification: "REGULAR",
      preferredLanguage: "en",
    },
    {
      tenantId,
      profileType: "TRAVEL_AGENT",
      firstName: "Expedia",
      companyName: "Expedia Booking",
      classification: "VIP",
      preferredLanguage: "en",
    }
  ]

  for (const p of profiles) {
    await prisma.profile.create({
      data: p
    })
  }

  console.log("Successfully seeded 4 profiles!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
