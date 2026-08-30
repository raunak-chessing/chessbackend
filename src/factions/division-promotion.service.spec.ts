import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DivisionPromotionService } from './division-promotion.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';

describe('DivisionPromotionService', () => {
  let service: DivisionPromotionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DivisionPromotionService, getPrismaMockProvider()],
    }).compile();

    service = module.get<DivisionPromotionService>(DivisionPromotionService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  describe('ensureDivisions', () => {
    it('should create default WOOD division if none exists', async () => {
      prismaMock.userDivision.findFirst.mockResolvedValueOnce(null);
      prismaMock.userDivision.create.mockResolvedValueOnce({ id: 'div-1' } as any);

      await service.ensureDivisions();

      expect(prismaMock.userDivision.findFirst).toHaveBeenCalledWith({ where: { tier: 'WOOD' } });
      expect(prismaMock.userDivision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tier: 'WOOD' }),
        })
      );
    });

    it('should do nothing if WOOD division exists', async () => {
      prismaMock.userDivision.findFirst.mockResolvedValueOnce({ id: 'div-1', tier: 'WOOD' } as any);

      await service.ensureDivisions();

      expect(prismaMock.userDivision.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentDivisions', () => {
    it('should return divisions with users', async () => {
      const mockDivs = [{ id: 'div-1', tier: 'WOOD', users: [] }];
      prismaMock.userDivision.findMany.mockResolvedValueOnce(mockDivs as any);

      const res = await service.getCurrentDivisions();

      expect(res).toEqual(mockDivs);
      expect(prismaMock.userDivision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ users: expect.anything() }),
          orderBy: { tier: 'asc' }
        })
      );
    });
  });

  describe('processDivisionPromotions', () => {
    it('should promote and relegate users', async () => {
      // Mock 3 divisions to test relegation, promotion, and keeping rank
      const mockDivisions = [
        { tier: 'WOOD', id: 'd-wood', users: Array(10).fill(0).map((_, i) => ({ id: `w${i}` })) }, // w0, w1 will promote
        { tier: 'STONE', id: 'd-stone', users: Array(10).fill(0).map((_, i) => ({ id: `s${i}` })) }, // s0, s1 promote. s8, s9 relegate
        { tier: 'LEGEND', id: 'd-legend', users: Array(10).fill(0).map((_, i) => ({ id: `l${i}` })) } // l8, l9 relegate. l0, l1 cannot promote
      ];

      prismaMock.userDivision.findMany.mockResolvedValueOnce(mockDivisions as any);

      // Mock creation of next week's divisions
      prismaMock.userDivision.create.mockImplementation((args: any) => Promise.resolve({ id: `new-${args.data.tier}`, tier: args.data.tier }));

      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any);

      await service.processDivisionPromotions();

      expect(prismaMock.userDivision.create).toHaveBeenCalledTimes(8);

      // E.g., w0 (index 0 < promoteCount 2) promotes from WOOD -> STONE (new-STONE)
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: expect.arrayContaining(['w0']) } },
          data: { divisionId: 'new-STONE', factionContribution: 0 }
        })
      );

      // s8 (index 8 >= 10 - 2) relegates from STONE -> WOOD (new-WOOD)
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: expect.arrayContaining(['s8']) } },
          data: { divisionId: 'new-WOOD', factionContribution: 0 }
        })
      );
    });

    it('should skip empty divisions', async () => {
      prismaMock.userDivision.findMany.mockResolvedValueOnce([
        { tier: 'WOOD', id: 'd-wood', users: [] }
      ] as any);
      prismaMock.userDivision.create.mockImplementation((args: any) => Promise.resolve({ id: `new-${args.data.tier}`, tier: args.data.tier }));

      await service.processDivisionPromotions();

      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
