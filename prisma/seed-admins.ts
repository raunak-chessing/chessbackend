import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const emails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    console.log('No ADMIN_EMAILS configured; nothing to promote.');
    return;
  }

  const result = await prisma.user.updateMany({
    where: { email: { in: emails } },
    data: { role: 'ADMIN' },
  });

  console.log(`Promoted ${result.count} user(s) matching ADMIN_EMAILS to role ADMIN.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
