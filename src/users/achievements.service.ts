import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  onModuleInit() {
    this.listenForEvents();
  }

  private listenForEvents() {
    const subscriber = this.redis.getClient().duplicate();
    subscriber.subscribe('gameserver:events', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to gameserver events', err);
      }
    });

    subscriber.on('message', async (channel, message) => {
      if (channel === 'gameserver:events') {
        try {
          const event = JSON.parse(message);
          if (event.type === 'game_ended') {
            await this.processGameEndAchievements(event.gameId);
          }
        } catch (e) {
          this.logger.error('Error processing achievement event', e);
        }
      }
    });
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
      
      // Notify frontend
      this.redis.getClient().publish('achievements:unlocked', JSON.stringify({ userId, code: achievementCode, title, description }));
    }
  }
}
