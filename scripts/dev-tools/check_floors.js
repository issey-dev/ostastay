const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const properties = await prisma.property.findMany()
  console.log("Properties:", JSON.stringify(properties, null, 2))
  
  console.log("Buildings:", JSON.stringify(buildings, null, 2))
  console.log("Floors:", JSON.stringify(floors, null, 2))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
