const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const contacts = await prisma.profileContact.findMany();
  console.log("Existing contacts:", contacts);
  
  // Since we changed the schema, PrismaClient might complain if it doesn't match the DB.
  // Instead, let's use raw SQL.
  await prisma.$executeRawUnsafe('DELETE FROM ProfileContact');
  console.log("Cleared ProfileContact table.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
