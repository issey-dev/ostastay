import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const count00 = await prisma.reservation.count({ where: { propertyId: "00000000-0000-0000-0000-000000000000" }})
  const countF1 = await prisma.reservation.count({ where: { propertyId: "f1f46360-2117-4cec-90f1-ba5512b28305" }})
  console.log(`0000: ${count00}`)
  console.log(`F1F4: ${countF1}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
