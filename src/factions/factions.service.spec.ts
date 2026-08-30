import { Test, TestingModule } from '@nestjs/testing';
import { FactionsService } from './factions.service';
import { EraLifecycleService } from './era-lifecycle.service';
import { DivisionPromotionService } from './division-promotion.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('FactionsService', () => {
  let service: FactionsService;
  let eraLifecycleService: jest.Mocked<Pick<EraLifecycleService, 'ensureActiveEra'>>;
  let divisionPromotionService: jest.Mocked<Pick<DivisionPromotionService, 'ensureDivisions'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    eraLifecycleService = { ensureActiveEra: jest.fn().mockResolvedValue(undefined) };
    divisionPromotionService = { ensureDivisions: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactionsService,
        getPrismaMockProvider(),
        { provide: EraLifecycleService, useValue: eraLifecycleService },
        { provide: DivisionPromotionService, useValue: divisionPromotionService },
      ],
    }).compile();

    service = module.get<FactionsService>(FactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('seeds factions, then delegates era and division bootstrap to their services', async () => {
      const seedSpy = jest.spyOn(service as any, 'seedFactions').mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(seedSpy).toHaveBeenCalledTimes(1);
      expect(eraLifecycleService.ensureActiveEra).toHaveBeenCalledTimes(1);
      expect(divisionPromotionService.ensureDivisions).toHaveBeenCalledTimes(1);
    });
  });

  describe('seedFactions', () => {
    it('should upsert the 3 default factions', async () => {
      prismaMock.faction.upsert.mockResolvedValue({} as any);

      await service['seedFactions']();

      expect(prismaMock.faction.upsert).toHaveBeenCalledTimes(3);
      expect(prismaMock.faction.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: 'Iron Syndicate' } }));
      expect(prismaMock.faction.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: 'Celestial Order' } }));
      expect(prismaMock.faction.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { name: 'Voidborn' } }));
    });
  });

  describe('getAllFactions', () => {
    it('should return factions ordered by score', async () => {
      prismaMock.faction.findMany.mockResolvedValueOnce([{ id: 'f1' }] as any);

      const res = await service.getAllFactions();

      expect(res).toEqual([{ id: 'f1' }]);
      expect(prismaMock.faction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { totalScore: 'desc' } })
      );
    });
  });

  describe('joinFaction', () => {
    it('should throw NotFoundException if faction does not exist', async () => {
      prismaMock.faction.findUnique.mockResolvedValueOnce(null);

      await expect(service.joinFaction('u1', 'f1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prismaMock.faction.findUnique.mockResolvedValueOnce({ id: 'f1' } as any);
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.joinFaction('u1', 'f1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if user already has a faction', async () => {
      prismaMock.faction.findUnique.mockResolvedValueOnce({ id: 'f1' } as any);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', factionId: 'f2' } as any);

      await expect(service.joinFaction('u1', 'f1')).rejects.toThrow(BadRequestException);
    });

    it('should update user if valid', async () => {
      prismaMock.faction.findUnique.mockResolvedValueOnce({ id: 'f1' } as any);
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', factionId: null } as any);
      prismaMock.user.update.mockResolvedValueOnce({ id: 'u1', factionId: 'f1' } as any);

      const res = await service.joinFaction('u1', 'f1');

      expect(res).toEqual({ id: 'u1', factionId: 'f1' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { factionId: 'f1', factionRank: 'GRUNT', factionContribution: 0 },
      });
    });
  });

  describe('incrementFactionScoreForUser', () => {
    it('should return null if user not found or no faction', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      expect(await service.incrementFactionScoreForUser('u1', 1200)).toBeNull();

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', factionId: null } as any);
      expect(await service.incrementFactionScoreForUser('u1', 1200)).toBeNull();
    });

    it('should calculate points, update rank, and update faction score', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', factionId: 'f1', factionContribution: 990 } as any);
      // Opponent Elo 1200 -> base 10 + (200 / 50) = 14 points. Total contrib = 1004 -> KNIGHT rank.

      prismaMock.user.update.mockResolvedValueOnce({} as any);
      prismaMock.faction.update.mockResolvedValueOnce({ id: 'f1', totalScore: 14 } as any);

      const res = await service.incrementFactionScoreForUser('u1', 1200);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { factionContribution: 1004, factionRank: 'KNIGHT' },
      });
      expect(prismaMock.faction.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { totalScore: { increment: 14 } },
      });
      expect(res).toEqual({ id: 'f1', totalScore: 14 });
    });

    it('should assign correct ranks based on contribution thresholds', async () => {
      const testCases = [
        { initial: 0, opponent: 1000, expectedRank: 'GRUNT', expectedPoints: 10 },
        { initial: 5000, opponent: 1050, expectedRank: 'COMMANDER', expectedPoints: 11 }, // 5011 > 5000
        { initial: 19990, opponent: 1500, expectedRank: 'WARLORD', expectedPoints: 20 }, // 20010 > 20000
      ];

      for (const tc of testCases) {
        jest.clearAllMocks();
        prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', factionId: 'f1', factionContribution: tc.initial } as any);

        await service.incrementFactionScoreForUser('u1', tc.opponent);

        expect(prismaMock.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ factionRank: tc.expectedRank })
          })
        );
      }
    });
  });
});
