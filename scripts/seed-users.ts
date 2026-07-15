import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const tenantId = "00000000-0000-0000-0000-000000000000"
  const passwordHash = await bcrypt.hash("password123", 10)

  const users = [
    // Housekeeping
    {
      tenantId,
      firstName: "Maria",
      lastName: "Garcia",
      email: "maria.g@example.com",
      passwordHash,
      role: "HOUSEKEEPING"
    },
    {
      tenantId,
      firstName: "Sarah",
      lastName: "Connor",
      email: "sarah.c@example.com",
      passwordHash,
      role: "HOUSEKEEPING"
    },
    {
      tenantId,
      firstName: "Elena",
      lastName: "Rodriguez",
      email: "elena.r@example.com",
      passwordHash,
      role: "HOUSEKEEPING"
    },
    // Maintenance
    {
      tenantId,
      firstName: "Bob",
      lastName: "Builder",
      email: "bob.b@example.com",
      passwordHash,
      role: "MAINTENANCE"
    },
    {
      tenantId,
      firstName: "FixIt",
      lastName: "Felix",
      email: "felix.f@example.com",
      passwordHash,
      role: "MAINTENANCE"
    },
    {
      tenantId,
      firstName: "Mike",
      lastName: "Mechanic",
      email: "mike.m@example.com",
      passwordHash,
      role: "MAINTENANCE"
    }
  ]

  console.log("Seeding users...")
  for (const u of users) {
    try {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: u
      })
      console.log(`Seeded user: ${u.firstName} ${u.lastName} (${u.role})`)
    } catch (e) {
      console.error(`Error seeding ${u.email}:`, e)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
