import { Injectable } from '@nestjs/common';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class WagerLockService {
  constructor(private readonly cacheService: CacheService) {}

  async withLock<T>(gameId: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
    const lockKey = `wager_lock:${gameId}`;

    const locked = await this.cacheService.acquireLock(lockKey, ttlSeconds);
    if (!locked) return null;

    try {
      return await fn();
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }
}
