CREATE TYPE "CosmeticType" AS ENUM ('BOARD_THEME', 'PIECE_SET', 'AVATAR_FRAME');

CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "CosmeticType" NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "priceGold" INTEGER,
    "priceAetherium" INTEGER,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopItem_key_key" ON "ShopItem"("key");

ALTER TABLE "Item" DROP COLUMN "name";
ALTER TABLE "Item" DROP COLUMN "type";
ALTER TABLE "Item" DROP COLUMN "rarity";
ALTER TABLE "Item" ADD COLUMN "shopItemId" TEXT NOT NULL;
ALTER TABLE "Item" ADD COLUMN "equipped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Item" ADD COLUMN "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Item" ADD CONSTRAINT "Item_shopItemId_fkey" FOREIGN KEY ("shopItemId") REFERENCES "ShopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Item_inventoryId_shopItemId_key" ON "Item"("inventoryId", "shopItemId");
CREATE INDEX "Item_inventoryId_equipped_idx" ON "Item"("inventoryId", "equipped");
