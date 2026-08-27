import { RedisService } from '../../redis/redis.service';

export const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  on: jest.fn(),
  hgetall: jest.fn(),
  hincrby: jest.fn(),
  smembers: jest.fn(),
  srem: jest.fn(),
  sadd: jest.fn(),
  hset: jest.fn(),
  hdel: jest.fn(),
  pipeline: jest.fn(() => ({
    exec: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    hset: jest.fn(),
  })),
};

export const mockRedisService: Partial<RedisService> = {
  getClient: jest.fn().mockReturnValue(mockRedisClient),
};

export const getRedisMockProvider = () => ({
  provide: RedisService,
  useValue: mockRedisService,
});
