import { Test, TestingModule } from '@nestjs/testing';
import { QuestsService } from './quests.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';

describe('QuestsService', () => {
  let service: QuestsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuestsService, getPrismaMockProvider()],
    }).compile();

    service = module.get<QuestsService>(QuestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActiveQuests', () => {
    it('should return existing active quests if they exist', async () => {
      const mockQuests = [{ id: 'q1' }];
      prismaMock.userQuest.findMany.mockResolvedValueOnce(mockQuests as any);

      const res = await service.getActiveQuests('u1');

      expect(res).toEqual(mockQuests);
      expect(prismaMock.userQuest.create).not.toHaveBeenCalled();
    });

    it('should generate basic quests if user Elo < 1000', async () => {
      prismaMock.userQuest.findMany.mockResolvedValueOnce([]);
      prismaMock.user.findUnique.mockResolvedValueOnce({ rating: 900 } as any);
      prismaMock.userQuest.create.mockImplementation((args: any) => Promise.resolve({ id: args.data.questId } as any));

      const res = await service.getActiveQuests('u1');

      expect(res).toHaveLength(3); // SOLVE_PUZZLES_BASIC, WIN_GAMES_RAPID, PLAY_BATTLES
      expect(res).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'SOLVE_PUZZLES_BASIC' }),
      ]));
      expect(prismaMock.userQuest.create).toHaveBeenCalledTimes(3);
    });

    it('should generate intermediate quests if 1000 <= Elo < 1800', async () => {
      prismaMock.userQuest.findMany.mockResolvedValueOnce([]);
      prismaMock.user.findUnique.mockResolvedValueOnce({ rating: 1500 } as any);
      prismaMock.userQuest.create.mockImplementation((args: any) => Promise.resolve({ id: args.data.questId } as any));

      const res = await service.getActiveQuests('u1');

      expect(res).toHaveLength(3); 
      expect(res).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'SOLVE_PUZZLES_INTERMEDIATE' }),
      ]));
    });



    it('should fallback to 1200 rating if user not found, which generates intermediate quests', async () => {
      prismaMock.userQuest.findMany.mockResolvedValueOnce([]);
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.userQuest.create.mockImplementation((args: any) => Promise.resolve({ id: args.data.questId } as any));

      const res = await service.getActiveQuests('u1');

      expect(res).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'SOLVE_PUZZLES_INTERMEDIATE' }),
      ]));
    });

    it('should generate expert quests if Elo >= 1800 (proper)', async () => {
      prismaMock.userQuest.findMany.mockResolvedValueOnce([]);
      prismaMock.user.findUnique.mockResolvedValueOnce({ rating: 2000 } as any);
      prismaMock.userQuest.create.mockImplementation((args: any) => Promise.resolve({ id: args.data.questId } as any));

      const res = await service.getActiveQuests('u1');

      expect(res).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'SOLVE_PUZZLES_EXPERT' }),
      ]));
    });
  });

  describe('incrementQuestProgress', () => {
    it('should return null if quest not found', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce(null);
      const res = await service.incrementQuestProgress('u1', 'q1');
      expect(res).toBeNull();
    });

    it('should increment progress but not complete if target not reached', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({
        id: 'uq1', progress: 1, target: 5
      } as any);
      prismaMock.userQuest.update.mockResolvedValueOnce({ id: 'uq1', progress: 2, completed: false } as any);

      const res = await service.incrementQuestProgress('u1', 'q1', 1);

      expect(prismaMock.userQuest.update).toHaveBeenCalledWith({
        where: { id: 'uq1' },
        data: { progress: 2, completed: false }
      });
      expect(res).toEqual({ id: 'uq1', progress: 2, completed: false });
    });

    it('should cap progress at target and mark completed', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({
        id: 'uq1', progress: 4, target: 5
      } as any);
      prismaMock.userQuest.update.mockResolvedValueOnce({ id: 'uq1', progress: 5, completed: true } as any);

      await service.incrementQuestProgress('u1', 'q1', 3);

      expect(prismaMock.userQuest.update).toHaveBeenCalledWith({
        where: { id: 'uq1' },
        data: { progress: 5, completed: true }
      });
    });
  });

  describe('claimQuestReward', () => {
    it('should throw Error if quest not found', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce(null);
      await expect(service.claimQuestReward('u1', 'q1')).rejects.toThrow('Quest not found');
    });

    it('should throw Error if quest not completed', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({ completed: false } as any);
      await expect(service.claimQuestReward('u1', 'q1')).rejects.toThrow('Quest not completed');
    });

    it('should throw Error if reward already claimed', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({ completed: true, rewardClaimed: true } as any);
      await expect(service.claimQuestReward('u1', 'q1')).rejects.toThrow('Reward already claimed');
    });

    it('should execute transaction to claim reward and unlock lore', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({
        id: 'uq1', completed: true, rewardClaimed: false, target: 10, loreUnlockId: 'lore-1'
      } as any);

      prismaMock.$transaction.mockImplementation(async (cb: any) => {
        return cb(prismaMock);
      });

      const res = await service.claimQuestReward('u1', 'q1');

      expect(prismaMock.userQuest.update).toHaveBeenCalledWith({
        where: { id: 'uq1' },
        data: { rewardClaimed: true },
      });

      expect(prismaMock.playerInventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          create: { userId: 'u1', gold: 500, aetherium: 50 },
        })
      );

      expect(prismaMock.userAchievement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_achievement: { userId: 'u1', achievement: 'lore-1' } }
        })
      );

      expect(res).toEqual({
        success: true,
        reward: { gold: 500, aetherium: 50 },
        loreUnlocked: 'lore-1'
      });
    });
    
    it('should execute transaction without lore unlock if not present', async () => {
      prismaMock.userQuest.findFirst.mockResolvedValueOnce({
        id: 'uq1', completed: true, rewardClaimed: false, target: 5, loreUnlockId: null
      } as any);

      prismaMock.$transaction.mockImplementation(async (cb: any) => {
        return cb(prismaMock);
      });

      const res = await service.claimQuestReward('u1', 'q1');

      expect(prismaMock.userAchievement.upsert).not.toHaveBeenCalled();
      expect(res.loreUnlocked).toBeNull();
    });
  });
});
