import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EraLifecycleService } from './era-lifecycle.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';

describe('EraLifecycleService', () => {
  let service: EraLifecycleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [EraLifecycleService, getPrismaMockProvider()],
    }).compile();

    service = module.get<EraLifecycleService>(EraLifecycleService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  describe('ensureActiveEra & startNewEra', () => {
    it('should start a new era if no active era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce(null); // activeEra
      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValue(undefined);

      await service.ensureActiveEra();

      expect(startNewEraSpy).toHaveBeenCalledTimes(1);
    });

    it('should not start a new era if active era exists', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ id: 'era-1' } as any); // activeEra
      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValue(undefined);

      await service.ensureActiveEra();

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

    it('startNewEra should swallow a concurrent-create race (P2002) without throwing', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ eraNumber: 5 } as any);
      prismaMock.factionEra.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(service.startNewEra()).resolves.not.toThrow();
    });

    it('startNewEra should rethrow any other error', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce(null);
      prismaMock.factionEra.create.mockRejectedValueOnce(new Error('db down'));

      await expect(service.startNewEra()).rejects.toThrow('db down');
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
      prismaMock.faction.findFirst.mockResolvedValueOnce(null);

      await service.distributeEraRewards();

      expect(prismaMock.factionEra.update).not.toHaveBeenCalled();
    });

    it('should end era, reward winners, and start new era', async () => {
      prismaMock.factionEra.findFirst.mockResolvedValueOnce({ id: 'era-1' } as any);
      prismaMock.faction.findFirst.mockResolvedValueOnce({ id: 'f-win' } as any);

      prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u1' } as any]);
      prismaMock.factionEra.update.mockResolvedValueOnce({} as any);
      prismaMock.playerInventory.upsert.mockResolvedValueOnce({} as any);

      const startNewEraSpy = jest.spyOn(service, 'startNewEra').mockResolvedValueOnce(undefined);

      await service.distributeEraRewards();

      expect(prismaMock.faction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { totalScore: 'desc' } }),
      );
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
