import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

export interface CacheSubscription {
  unsubscribe(): void;
}

/**
 * Application-level cache/pub-sub facade over ioredis.
 *
 * Every caller used to reach through RedisService.getClient() and talk
 * directly to the raw ioredis client — every one of ~30 call sites coupled
 * to a concrete third-party API. This is the single place that owns that
 * dependency now; callers depend on this interface instead.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redisService: RedisService) {}

  private get client(): Redis {
    return this.redisService.getClient();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  // --- strings / JSON ---

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Sets the key only if absent. Returns true if this call set it (first time). */
  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  // --- counters ---

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decrement(key: string): Promise<number> {
    return this.client.decr(key);
  }

  /** Fixed-window rate limiter: true if the call is within `limit` per `windowSeconds`. */
  async checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSeconds);
    }
    return count <= limit;
  }

  // --- hashes ---

  async hashSet(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  async hashSetAll(key: string, values: Record<string, string | number>): Promise<void> {
    await this.client.hset(key, values);
  }

  async hashGet(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hashGetAll(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hashIncrementBy(key: string, field: string, amount: number): Promise<number> {
    return this.client.hincrby(key, field, amount);
  }

  async hashDelete(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  // --- sets ---

  async addToSet(key: string, member: string): Promise<void> {
    await this.client.sadd(key, member);
  }

  async removeFromSet(key: string, member: string): Promise<void> {
    await this.client.srem(key, member);
  }

  async getSetMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  // --- simple locks (SET NX EX / DEL) ---

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    return this.setIfNotExists(key, '1', ttlSeconds);
  }

  async releaseLock(key: string): Promise<void> {
    await this.delete(key);
  }

  // --- pub/sub ---

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  /**
   * Subscribes on a dedicated duplicated connection (ioredis requires a
   * connection in subscriber mode to be used for nothing else) and invokes
   * `handler` for every message on `channel`. Call `.unsubscribe()` to
   * disconnect the duplicated connection.
   */
  subscribe(channel: string, handler: (message: string) => void): CacheSubscription {
    const subscriber = this.client.duplicate();
    subscriber.subscribe(channel, (err) => {
      if (err) this.logger.error(`Failed to subscribe to ${channel}`, err);
    });
    subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) handler(message);
    });
    return {
      unsubscribe: () => {
        subscriber.disconnect();
      },
    };
  }
}
