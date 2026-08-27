import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class WagerLockService {
  constructor(private readonly redisService: RedisService) {}

  async withLock<T>(gameId: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
    const redis = this.redisService.getClient();
    const lockKey = `wager_lock:${gameId}`;

    const locked = await redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
    if (!locked) return null;

    try {
      return await fn();
    } finally {
      await redis.del(lockKey);
    }
  }
}
