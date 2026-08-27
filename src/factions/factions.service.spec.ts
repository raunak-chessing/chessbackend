import { Test, TestingModule } from '@nestjs/testing';
import { FactionsService } from './factions.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';

describe('FactionsService', () => {
  let service: FactionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [FactionsService, getPrismaMockProvider()],
    }).compile();

    service = module.get<FactionsService>(FactionsService);
    // Disable actual logging in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should call seedFactions, ensureActiveEra, and ensureDivisions', async () => {
      const seedSpy = jest.spyOn(service as any, 'seedFactions').mockResolvedValue(undefined);
      const eraSpy = jest.spyOn(service as any, 'ensureActiveEra').mockResolvedValue(undefined);
      const divSpy = jest.spyOn(service as any, 'ensureDivisions').mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(seedSpy).toHaveBeenCalledTimes(1);
      expect(eraSpy).toHaveBeenCalledTimes(1);
      expect(divSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensureDivisions', () => {
    it('should create default WOOD division if none exists', async () => {
      prismaMock.userDivision.findFirst.mockResolvedValueOnce(null);
      prismaMock.userDivision.create.mockResolvedValueOnce({ id: 'div-1' } as any);

      await service['ensureDivisions']();

      expect(prismaMock.userDivision.findFirst).toHaveBeenCalledWith({ where: { tier: 'WOOD' } });
      expect(prismaMock.userDivision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tier: 'WOOD' }),
        })
      );
    });

    it('should do nothing if WOOD division exists', async () => {
      prismaMock.userDivision.findFirst.mockResolvedValueOnce({ id: 'div-1', tier: 'WOOD' } as any);
      
      await service['ensureDivisions']();

      expect(prismaMock.userDivision.create).not.toHaveBeenCalled();
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

  describe('ensureActiveEra & startNewEra', () => {
    it('should start a new era if no active era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce(null); // activeEra
      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValue(undefined);

      await service['ensureActiveEra']();

      expect(startNewEraSpy).toHaveBeenCalledTimes(1);
    });

    it('should not start a new era if active era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ id: 'era-1' } as any); // activeEra
      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValue(undefined);

      await service['ensureActiveEra']();

      expect(startNewEraSpy).not.toHaveBeenCalled();
    });

    it('startNewEra should create era 1 if no last era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce(null); // lastEra
      prismaMock.factionEra.create.mockResolvedValueOnce({} as any);
      prismaMock.faction.updateMany.mockResolvedValueOnce({ count: 3 });
      prismaMock.user.updateMany.mockResolvedValueOnce({ count: 10 });

      await service.startNewEra();

      expect(prismaMock.factionEra.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eraNumber: 1 }),
      });
      expect(prismaMock.faction.updateMany).toHaveBeenCalledWith({ data: { totalScore: 0 } });
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({ data: { factionContribution: 0, factionRank: 'GRUNT' } });
    });

    it('startNewEra should increment era number if last era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ eraNumber: 5 } as any); // lastEra
      
      await service.startNewEra();

      expect(prismaMock.factionEra.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eraNumber: 6 }),
      });
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
      const TIERS = ['WOOD', 'STONE', 'BRONZE', 'SILVER', 'CRYSTAL', 'ELITE', 'CHAMPION', 'LEGEND'];
      prismaMock.userDivision.create.mockImplementation((args: any) => Promise.resolve({ id: `new-${args.data.tier}`, tier: args.data.tier }));
      
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any);

      await service.processDivisionPromotions();

      expect(prismaMock.userDivision.create).toHaveBeenCalledTimes(8);
      
      // Expect bulk updates to have been called.
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

  describe('distributeEraRewards', () => {
    it('should do nothing if no active era', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce(null);
      await service.distributeEraRewards();
      expect(prismaMock.factionEra.update).not.toHaveBeenCalled();
    });

    it('should do nothing if no factions exist', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ id: 'era-1' } as any);
      jest.spyOn(service, 'getAllFactions').mockResolvedValueOnce([]);
      
      await service.distributeEraRewards();
      
      expect(prismaMock.factionEra.update).not.toHaveBeenCalled();
    });

    it('should end era, reward winners, and start new era', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ id: 'era-1' } as any);
      jest.spyOn(service, 'getAllFactions').mockResolvedValueOnce([{ id: 'f-win' } as any]);
      
      prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u1' } as any]);
      prismaMock.factionEra.update.mockResolvedValueOnce({} as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({} as any);
      
      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValueOnce(undefined);

      await service.distributeEraRewards();

      expect(prismaMock.factionEra.update).toHaveBeenCalledWith({
        where: { id: 'era-1' },
        data: expect.objectContaining({ winnerId: 'f-win' }),
      });

      expect(prismaMock.playerInventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          create: expect.objectContaining({ aetherium: 500, gold: 5000 }),
        })
      );

      expect(startNewEraSpy).toHaveBeenCalledTimes(1);
    });
  });
});
