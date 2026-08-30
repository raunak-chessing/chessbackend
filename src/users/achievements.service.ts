import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private prisma: PrismaService,
    private cacheService: CacheService,
  ) {}

  onModuleInit() {
    this.listenForEvents();
  }

  private listenForEvents() {
    this.cacheService.subscribe('gameserver:events', (message) => {
      void this.handleMessage(message);
    });
  }

  private async handleMessage(message: string): Promise<void> {
    try {
      const event = JSON.parse(message);
      if (event.type === 'game_ended') {
        await this.processGameEndAchievements(event.gameId);
      }
    } catch (e) {
      this.logger.error('Error processing achievement event', e);
    }
  }

  private async processGameEndAchievements(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { winner: true, whitePlayerId: true, blackPlayerId: true }
    });

    if (!game || !game.winner || game.winner === 'DRAW') return;

    let winnerId = '';
    if (game.winner === 'WHITE') winnerId = game.whitePlayerId;
    if (game.winner === 'BLACK' && game.blackPlayerId) winnerId = game.blackPlayerId;

    if (!winnerId) return;

    // First Win Achievement
    await this.awardAchievement(winnerId, 'FIRST_WIN', 'First Blood', 'Win your first game of chess.');

    // 10 Wins Achievement
    const wins = await this.prisma.game.count({
      where: {
        OR: [
          { whitePlayerId: winnerId, winner: 'WHITE' },
          { blackPlayerId: winnerId, winner: 'BLACK' }
        ]
      }
    });

    if (wins >= 10) {
      await this.awardAchievement(winnerId, 'GAMES_10', 'Veteran', 'Win 10 games.');
    }
  }

  public async awardAchievement(userId: string, achievementCode: string, title: string, description: string) {
    const existing = await this.prisma.userAchievement.findUnique({
      where: { userId_achievement: { userId, achievement: achievementCode } }
    });

    if (!existing) {
      await this.prisma.userAchievement.create({
        data: {
          userId,
          achievement: achievementCode,
        }
      });
      this.logger.log(`Awarded achievement ${achievementCode} to user ${userId}`);

      // Notify frontend (fire-and-forget, matching the original — not on
      // the critical path of granting the achievement).
      this.cacheService.publish('achievements:unlocked', JSON.stringify({ userId, code: achievementCode, title, description }));
    }
  }
}
