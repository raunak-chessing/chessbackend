import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SHOP_ITEMS = [
  {
    key: 'board-classic-wood',
    name: 'Classic Wood',
    description: 'A warm, traditional wooden board.',
    type: 'BOARD_THEME' as const,
    rarity: 'COMMON',
    priceGold: 500,
  },
  {
    key: 'board-obsidian',
    name: 'Obsidian',
    description: 'A sleek black-and-gold marble board.',
    type: 'BOARD_THEME' as const,
    rarity: 'RARE',
    priceGold: 2500,
  },
  {
    key: 'board-aetherium-glass',
    name: 'Aetherium Glass',
    description: 'A luminous board forged from crystallized aetherium.',
    type: 'BOARD_THEME' as const,
    rarity: 'EPIC',
    priceAetherium: 400,
  },
  {
    key: 'pieces-classic-staunton',
    name: 'Classic Staunton',
    description: 'The timeless tournament standard.',
    type: 'PIECE_SET' as const,
    rarity: 'COMMON',
    priceGold: 500,
  },
  {
    key: 'pieces-obsidian-glass',
    name: 'Obsidian Glass',
    description: 'Frosted glass pieces with a dark, weighty presence.',
    type: 'PIECE_SET' as const,
    rarity: 'RARE',
    priceGold: 2500,
  },
  {
    key: 'frame-champions-laurel',
    name: "Champion's Laurel",
    description: 'A golden laurel frame for your avatar.',
    type: 'AVATAR_FRAME' as const,
    rarity: 'EPIC',
    priceAetherium: 600,
  },
];

async function main() {
  console.log('Seeding shop catalog...');
  for (const item of SHOP_ITEMS) {
    await prisma.shopItem.upsert({
      where: { key: item.key },
      create: item,
      update: item,
    });
  }
  console.log(`Seeded ${SHOP_ITEMS.length} shop items!`);
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
