ALTER TABLE "Game" ADD COLUMN "wagersSettledAt" TIMESTAMP(3);

ALTER TABLE "PlayerInventory" ADD CONSTRAINT "PlayerInventory_gold_non_negative" CHECK ("gold" >= 0);
