import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async flagUser(userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isFlaggedForCheating: true, flaggedReason: reason ?? 'Flagged by administrator' },
    });
  }

  async deleteChatMessage(messageId: string) {
    await this.cacheService.publish('admin:events', JSON.stringify({ type: 'chat_message_deleted', messageId }));
    return { messageId, deleted: true };
  }

  async setMatchmakingPaused(paused: boolean) {
    if (paused) {
      await this.cacheService.set('matchmaking:paused', '1');
    } else {
      await this.cacheService.delete('matchmaking:paused');
    }
    return { paused };
  }
}
