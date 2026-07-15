const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TENANT_ID = '00000000-0000-0000-0000-000000000000'

const systemCodes = [
  // ── Gender ────────────────────────────────────────────
  { category: 'GENDER', code: 'M',  value: 'Male',              sortOrder: 1 },
  { category: 'GENDER', code: 'F',  value: 'Female',            sortOrder: 2 },
  { category: 'GENDER', code: 'O',  value: 'Other',             sortOrder: 3 },
  { category: 'GENDER', code: 'N',  value: 'Prefer Not to Say', sortOrder: 4 },

  // ── Title ─────────────────────────────────────────────
  { category: 'TITLE', code: 'MR',   value: 'Mr',   sortOrder: 1 },
  { category: 'TITLE', code: 'MRS',  value: 'Mrs',  sortOrder: 2 },
  { category: 'TITLE', code: 'MS',   value: 'Ms',   sortOrder: 3 },
  { category: 'TITLE', code: 'DR',   value: 'Dr',   sortOrder: 4 },
  { category: 'TITLE', code: 'PROF', value: 'Prof', sortOrder: 5 },

  // ── Nationality ───────────────────────────────────────
  { category: 'NATIONALITY', code: 'MV', value: 'Maldivian',   sortOrder: 1 },
  { category: 'NATIONALITY', code: 'IN', value: 'Indian',      sortOrder: 2 },
  { category: 'NATIONALITY', code: 'US', value: 'American',    sortOrder: 3 },
  { category: 'NATIONALITY', code: 'GB', value: 'British',     sortOrder: 4 },
  { category: 'NATIONALITY', code: 'DE', value: 'German',      sortOrder: 5 },
  { category: 'NATIONALITY', code: 'CN', value: 'Chinese',     sortOrder: 6 },
  { category: 'NATIONALITY', code: 'JP', value: 'Japanese',    sortOrder: 7 },
  { category: 'NATIONALITY', code: 'AU', value: 'Australian',  sortOrder: 8 },
  { category: 'NATIONALITY', code: 'FR', value: 'French',      sortOrder: 9 },
  { category: 'NATIONALITY', code: 'IT', value: 'Italian',     sortOrder: 10 },

  // ── ID / Document Type ────────────────────────────────
  { category: 'ID_TYPE', code: 'PASSPORT',        value: 'Passport',         sortOrder: 1 },
  { category: 'ID_TYPE', code: 'NATIONAL_ID',     value: 'National ID',      sortOrder: 2 },
  { category: 'ID_TYPE', code: 'DRIVERS_LICENSE',  value: "Driver's License", sortOrder: 3 },
]

async function main() {
  console.log('🌱 Seeding system codes...\n')

  let created = 0
  let skipped = 0

  for (const sc of systemCodes) {
    try {
      await prisma.systemCode.upsert({
        where: {
          tenantId_category_code: {
            tenantId: TENANT_ID,
            category: sc.category,
            code: sc.code,
          },
        },
        update: {
          value: sc.value,
          sortOrder: sc.sortOrder,
          isActive: true,
        },
        create: {
          tenantId: TENANT_ID,
          ...sc,
        },
      })
      console.log(`  ✅ ${sc.category} / ${sc.code} → ${sc.value}`)
      created++
    } catch (err) {
      console.log(`  ⚠️  Skipped ${sc.category}/${sc.code}: ${err.message}`)
      skipped++
    }
  }

  console.log(`\n✨ Done — ${created} upserted, ${skipped} skipped.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
