import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('ShopService', () => {
  let service: ShopService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShopService, getPrismaMockProvider()],
    }).compile();

    service = module.get<ShopService>(ShopService);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('purchase', () => {
    it('rejects when the shop item does not exist', async () => {
      prismaMock.shopItem.findUnique.mockResolvedValueOnce(null);

      await expect(service.purchase('user-1', 'item-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when the item is already owned', async () => {
      prismaMock.shopItem.findUnique.mockResolvedValueOnce({ id: 'item-1', priceGold: 500, priceAetherium: null } as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({ id: 'inv-1', userId: 'user-1' } as any);
      prismaMock.item.findUnique.mockResolvedValueOnce({ id: 'existing-item' } as any);

      await expect(service.purchase('user-1', 'item-1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.item.create).not.toHaveBeenCalled();
    });

    it('rejects and does not create the item when funds are insufficient', async () => {
      prismaMock.shopItem.findUnique.mockResolvedValueOnce({ id: 'item-1', priceGold: 500, priceAetherium: null } as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({ id: 'inv-1', userId: 'user-1' } as any);
      prismaMock.item.findUnique.mockResolvedValueOnce(null);
      prismaMock.playerInventory.updateMany.mockResolvedValueOnce({ count: 0 } as any);

      await expect(service.purchase('user-1', 'item-1')).rejects.toThrow('Insufficient funds');
      expect(prismaMock.item.create).not.toHaveBeenCalled();
    });

    it('debits the correct currency and creates the item on success', async () => {
      prismaMock.shopItem.findUnique.mockResolvedValueOnce({ id: 'item-1', priceGold: null, priceAetherium: 400 } as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({ id: 'inv-1', userId: 'user-1' } as any);
      prismaMock.item.findUnique.mockResolvedValueOnce(null);
      prismaMock.playerInventory.updateMany.mockResolvedValueOnce({ count: 1 } as any);
      const created = { id: 'new-item', inventoryId: 'inv-1', shopItemId: 'item-1', equipped: false };
      prismaMock.item.create.mockResolvedValueOnce(created as any);

      const result = await service.purchase('user-1', 'item-1');

      expect(prismaMock.playerInventory.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', aetherium: { gte: 400 } },
        data: { aetherium: { decrement: 400 } },
      });
      expect(result).toEqual(created);
    });

    it('translates a unique-constraint race into a friendly error', async () => {
      prismaMock.shopItem.findUnique.mockResolvedValueOnce({ id: 'item-1', priceGold: 500, priceAetherium: null } as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({ id: 'inv-1', userId: 'user-1' } as any);
      prismaMock.item.findUnique.mockResolvedValueOnce(null);
      prismaMock.playerInventory.updateMany.mockResolvedValueOnce({ count: 1 } as any);
      prismaMock.item.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002', clientVersion: '7.8.0' }),
      );

      await expect(service.purchase('user-1', 'item-1')).rejects.toThrow('You already own this item');
    });
  });
});
