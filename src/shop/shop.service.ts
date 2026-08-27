import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalog() {
    return this.prisma.shopItem.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async purchase(userId: string, shopItemId: string) {
    const shopItem = await this.prisma.shopItem.findUnique({ where: { id: shopItemId } });
    if (!shopItem) throw new NotFoundException('Shop item not found');

    const inventory = await this.prisma.playerInventory.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const alreadyOwned = await this.prisma.item.findUnique({
      where: { inventoryId_shopItemId: { inventoryId: inventory.id, shopItemId } },
    });
    if (alreadyOwned) throw new BadRequestException('You already own this item');

    const debitWhere: Prisma.PlayerInventoryWhereInput = { userId };
    const debitData: Prisma.PlayerInventoryUpdateInput = {};
    if (shopItem.priceGold) {
      debitWhere.gold = { gte: shopItem.priceGold };
      debitData.gold = { decrement: shopItem.priceGold };
    }
    if (shopItem.priceAetherium) {
      debitWhere.aetherium = { gte: shopItem.priceAetherium };
      debitData.aetherium = { decrement: shopItem.priceAetherium };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const debit = await tx.playerInventory.updateMany({ where: debitWhere, data: debitData });
        if (debit.count === 0) {
          throw new BadRequestException('Insufficient funds');
        }

        return tx.item.create({
          data: { inventoryId: inventory.id, shopItemId },
          include: { shopItem: true },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('You already own this item');
      }
      throw err;
    }
  }
}
