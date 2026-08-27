import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface QuestDefinition {
  id: string;
  target: number;
}

const QUEST_TYPES: QuestDefinition[] = [
  { id: 'WIN_GAMES', target: 3 },
  { id: 'SOLVE_PUZZLES', target: 5 },
  { id: 'PLAY_BATTLES', target: 2 },
  { id: 'WIN_PUZZLE_BATTLE', target: 1 },
];

@Injectable()
export class QuestsService {
  constructor(private prisma: PrismaService) {}

  private getEndOfDay(): Date {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end;
  }

  async getActiveQuests(userId: string) {
    const now = new Date();

    let quests = await this.prisma.userQuest.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
      },
    });

    if (quests.length === 0) {
      const endOfDay = this.getEndOfDay();
      
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { rating: true }
      });
      const elo = user?.rating || 1200;

      interface GeneratedQuest {
        id: string;
        target: number;
        chainId?: string;
        loreUnlockId?: string;
      }

      const generated: GeneratedQuest[] = [];
      if (elo < 1000) {
        generated.push({ id: 'SOLVE_PUZZLES_BASIC', target: 5, chainId: 'BEGINNER_TACTICS' });
        generated.push({ id: 'WIN_GAMES_RAPID', target: 2 });
      } else if (elo < 1800) {
        generated.push({ id: 'SOLVE_PUZZLES_INTERMEDIATE', target: 10, chainId: 'ADVANCED_TACTICS' });
        generated.push({ id: 'WIN_GAMES_BLITZ', target: 3 });
      } else {
        generated.push({ id: 'SOLVE_PUZZLES_EXPERT', target: 15, loreUnlockId: 'LORE_GRANDMASTER_1' });
        generated.push({ id: 'WIN_GAMES_BULLET', target: 5 });
      }
      generated.push({ id: 'PLAY_BATTLES', target: 2 });

      const newQuests = await Promise.all(
        generated.map((q) =>
          this.prisma.userQuest.create({
            data: {
              userId,
              questId: q.id,
              target: q.target,
              progress: 0,
              completed: false,
              expiresAt: endOfDay,
              chainId: q.chainId || null,
              loreUnlockId: q.loreUnlockId || null,
            },
          }),
        ),
      );

      quests = newQuests;
    }

    return quests;
  }

  async incrementQuestProgress(
    userId: string,
    questId: string,
    amount: number = 1,
  ) {
    const now = new Date();

    const activeQuest = await this.prisma.userQuest.findFirst({
      where: {
        userId,
        questId,
        completed: false,
        expiresAt: { gt: now },
      },
    });

    if (!activeQuest) return null;

    const newProgress = Math.min(
      activeQuest.progress + amount,
      activeQuest.target,
    );
    const completed = newProgress >= activeQuest.target;

    const updated = await this.prisma.userQuest.update({
      where: { id: activeQuest.id },
      data: {
        progress: newProgress,
        completed,
      },
    });

    return updated;
  }

  async claimQuestReward(userId: string, questId: string) {
    const quest = await this.prisma.userQuest.findFirst({
      where: {
        id: questId,
        userId,
      },
    });

    if (!quest) throw new Error('Quest not found');
    if (!quest.completed) throw new Error('Quest not completed');
    if (quest.rewardClaimed) throw new Error('Reward already claimed');

    // Dynamic scaling for rewards based on quest target
    const goldReward = quest.target * 50;
    const aetheriumReward = quest.target * 5;

    await this.prisma.$transaction(async (tx) => {
      await tx.userQuest.update({
        where: { id: quest.id },
        data: { rewardClaimed: true },
      });
      
      await tx.playerInventory.upsert({
        where: { userId },
        create: {
          userId,
          gold: goldReward,
          aetherium: aetheriumReward,
        },
        update: {
          gold: { increment: goldReward },
          aetherium: { increment: aetheriumReward },
        },
      });

      // Handle Lore Unlock
      if (quest.loreUnlockId) {
        await tx.userAchievement.upsert({
          where: { userId_achievement: { userId, achievement: quest.loreUnlockId } },
          create: { userId, achievement: quest.loreUnlockId },
          update: {} // already unlocked
        });
      }
    });

    return { 
      success: true, 
      reward: { gold: goldReward, aetherium: aetheriumReward },
      loreUnlocked: quest.loreUnlockId || null
    };
  }
}
