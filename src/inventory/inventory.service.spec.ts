import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { BadRequestException } from '@nestjs/common';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, getPrismaMockProvider()],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prismaMock.$transaction.mockImplementation(async (ops: any) => Promise.all(ops));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('equipItem', () => {
    it('rejects items not owned by the user', async () => {
      prismaMock.item.findUnique.mockResolvedValueOnce({
        id: 'item-1',
        inventoryId: 'inv-1',
        inventory: { userId: 'someone-else' },
        shopItem: { type: 'BOARD_THEME' },
      } as any);

      await expect(service.equipItem('user-1', 'item-1')).rejects.toThrow(BadRequestException);
    });

    it('unequips other items of the same cosmetic type before equipping', async () => {
      prismaMock.item.findUnique.mockResolvedValueOnce({
        id: 'item-1',
        inventoryId: 'inv-1',
        inventory: { userId: 'user-1' },
        shopItem: { type: 'BOARD_THEME' },
      } as any);
      prismaMock.playerInventory.findUnique.mockResolvedValueOnce({
        gold: 0,
        aetherium: 0,
        items: [],
      } as any);

      await service.equipItem('user-1', 'item-1');

      expect(prismaMock.item.updateMany).toHaveBeenCalledWith({
        where: { inventoryId: 'inv-1', shopItem: { type: 'BOARD_THEME' }, equipped: true },
        data: { equipped: false },
      });
      expect(prismaMock.item.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { equipped: true },
      });
    });
  });

  describe('unequipItem', () => {
    it('rejects items not owned by the user', async () => {
      prismaMock.item.findUnique.mockResolvedValueOnce({
        id: 'item-1',
        inventory: { userId: 'someone-else' },
      } as any);

      await expect(service.unequipItem('user-1', 'item-1')).rejects.toThrow(BadRequestException);
    });
  });
});
