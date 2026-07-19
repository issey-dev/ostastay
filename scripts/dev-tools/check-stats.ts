import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const profiles = await prisma.profile.findMany({
    where: { profileType: "GUEST" },
    orderBy: { totalStays: 'desc' },
    take: 10
  })
  console.log(profiles.map(p => ({ name: p.firstName, stays: p.totalStays, rev: p.totalRevenue })))
}

main().catch(console.error).finally(() => prisma.$disconnect())
