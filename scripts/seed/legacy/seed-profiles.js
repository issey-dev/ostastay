const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Resolve the demo enterprise dynamically rather than a hardcoded id (see
  // src/app/api/auth/seed/route.ts, which creates it by slug "demo").
  const enterprise = await prisma.enterprise.findUnique({ where: { slug: "demo" } })
  if (!enterprise) throw new Error('No "demo" enterprise found — run the seed route first (POST /api/auth/seed)')
  const enterpriseId = enterprise.id

  // Seed profiles
  const profiles = [
    {
      enterpriseId,
      profileType: "GUEST",
      firstName: "John",
      lastName: "Doe",
      classification: "VIP",
      preferredLanguage: "en",
    },
    {
      enterpriseId,
      profileType: "GUEST",
      firstName: "Jane",
      lastName: "Smith",
      classification: "REGULAR",
      preferredLanguage: "en",
    },
    {
      enterpriseId,
      profileType: "COMPANY",
      firstName: "Acme", // required by schema even for companies
      companyName: "Acme Corp",
      classification: "REGULAR",
      preferredLanguage: "en",
    },
    {
      enterpriseId,
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
