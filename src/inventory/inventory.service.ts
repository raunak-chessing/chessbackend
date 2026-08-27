import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async getInventory(userId: string) {
    const inventory = await this.prisma.playerInventory.findUnique({
      where: { userId },
      include: {
        items: { include: { shopItem: true } },
      },
    });

    if (!inventory) {
      return { gold: 0, aetherium: 0, items: [] };
    }

    return inventory;
  }

  async equipItem(userId: string, itemId: string) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      include: { inventory: true, shopItem: true },
    });
    if (!item || item.inventory.userId !== userId) {
      throw new BadRequestException('Item not found in your inventory');
    }

    await this.prisma.$transaction([
      this.prisma.item.updateMany({
        where: { inventoryId: item.inventoryId, shopItem: { type: item.shopItem.type }, equipped: true },
        data: { equipped: false },
      }),
      this.prisma.item.update({ where: { id: itemId }, data: { equipped: true } }),
    ]);

    return this.getInventory(userId);
  }

  async unequipItem(userId: string, itemId: string) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      include: { inventory: true },
    });
    if (!item || item.inventory.userId !== userId) {
      throw new BadRequestException('Item not found in your inventory');
    }

    await this.prisma.item.update({ where: { id: itemId }, data: { equipped: false } });

    return this.getInventory(userId);
  }
}
