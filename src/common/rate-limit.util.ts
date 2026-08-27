import type Redis from 'ioredis';

export async function checkRateLimit(
  redis: Pick<Redis, 'incr' | 'expire'>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}
