import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AdminService {
  private redisClient: ReturnType<RedisService['getClient']>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    this.redisClient = this.redisService.getClient();
  }

  async flagUser(userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isFlaggedForCheating: true, flaggedReason: reason ?? 'Flagged by administrator' },
    });
  }

  async deleteChatMessage(messageId: string) {
    await this.redisClient.publish('admin:events', JSON.stringify({ type: 'chat_message_deleted', messageId }));
    return { messageId, deleted: true };
  }

  async setMatchmakingPaused(paused: boolean) {
    if (paused) {
      await this.redisClient.set('matchmaking:paused', '1');
    } else {
      await this.redisClient.del('matchmaking:paused');
    }
    return { paused };
  }
}
