import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { SYSTEM_ROLE_DEFS, ensureRoles } from "../prisma/rbac-seed-data"

const prisma = new PrismaClient()

async function main() {
  const osta = await prisma.enterprise.findUnique({ where: { slug: "osta" } })
  if (!osta) throw new Error('No "osta" enterprise found — run the seed route first (POST /api/auth/seed)')

  const demo = await prisma.enterprise.findUnique({ where: { slug: "demo" } })
  if (!demo) throw new Error('No "demo" enterprise found — run the seed route first (POST /api/auth/seed)')

  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true)
  const passwordHash = await bcrypt.hash("password123", 10)

  const users = [
    // Housekeeping
    { firstName: "Maria", lastName: "Garcia", email: "maria.g@example.com", roleId: roleIds["Housekeeping"] },
    { firstName: "Sarah", lastName: "Connor", email: "sarah.c@example.com", roleId: roleIds["Housekeeping"] },
    { firstName: "Elena", lastName: "Rodriguez", email: "elena.r@example.com", roleId: roleIds["Housekeeping"] },
    // Maintenance
    { firstName: "Bob", lastName: "Builder", email: "bob.b@example.com", roleId: roleIds["Maintenance"] },
    { firstName: "FixIt", lastName: "Felix", email: "felix.f@example.com", roleId: roleIds["Maintenance"] },
    { firstName: "Mike", lastName: "Mechanic", email: "mike.m@example.com", roleId: roleIds["Maintenance"] },
  ]

  console.log("Seeding users...")
  for (const u of users) {
    try {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        create: {
          enterpriseId: demo.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          passwordHash,
          roleId: u.roleId,
          scope: "ENTERPRISE",
        }
      })
      console.log(`Seeded user: ${u.firstName} ${u.lastName}`)
    } catch (e) {
      console.error(`Error seeding ${u.email}:`, e)
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
