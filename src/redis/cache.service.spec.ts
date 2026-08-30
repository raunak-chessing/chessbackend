import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { getRedisMockProvider, mockRedisClient } from '../test/mocks/redis.mock';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService, getRedisMockProvider()],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getJson / setJson', () => {
    it('returns null when the key is absent', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      expect(await service.getJson('missing')).toBeNull();
    });

    it('parses the stored JSON', async () => {
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
      expect(await service.getJson('key')).toEqual({ a: 1 });
    });

    it('serializes and applies a TTL when set', async () => {
      await service.setJson('key', { a: 1 }, 60);
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', JSON.stringify({ a: 1 }), 'EX', 60);
    });

    it('sets without a TTL when none is given', async () => {
      await service.setJson('key', { a: 1 });
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', JSON.stringify({ a: 1 }));
    });
  });

  describe('setIfNotExists', () => {
    it('returns true when the SET NX succeeds', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      expect(await service.setIfNotExists('key', '1', 60)).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', '1', 'EX', 60, 'NX');
    });

    it('returns false when the key already existed', async () => {
      mockRedisClient.set.mockResolvedValueOnce(null);
      expect(await service.setIfNotExists('key', '1', 60)).toBe(false);
    });
  });

  describe('checkRateLimit', () => {
    it('allows the call and does not re-arm the TTL when under the window start', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(5);
      expect(await service.checkRateLimit('key', 10, 5)).toBe(true);
      expect(mockRedisClient.expire).not.toHaveBeenCalled();
    });

    it('sets the expiry only on the first hit in a window', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(1);
      await service.checkRateLimit('key', 10, 5);
      expect(mockRedisClient.expire).toHaveBeenCalledWith('key', 5);
    });

    it('rejects once the count exceeds the limit', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(11);
      expect(await service.checkRateLimit('key', 10, 5)).toBe(false);
    });
  });

  describe('exists', () => {
    it('maps a nonzero EXISTS reply to true', async () => {
      mockRedisClient.exists.mockResolvedValueOnce(1);
      expect(await service.exists('key')).toBe(true);
    });

    it('maps a zero EXISTS reply to false', async () => {
      mockRedisClient.exists.mockResolvedValueOnce(0);
      expect(await service.exists('key')).toBe(false);
    });
  });

  describe('locks', () => {
    it('acquireLock delegates to setIfNotExists semantics', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');
      expect(await service.acquireLock('lock:1', 5)).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('lock:1', '1', 'EX', 5, 'NX');
    });

    it('releaseLock deletes the key', async () => {
      await service.releaseLock('lock:1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('lock:1');
    });
  });

  describe('subscribe', () => {
    it('subscribes on a duplicated connection and routes matching messages', () => {
      const duplicated = {
        subscribe: jest.fn((_channel: string, cb: (err: Error | null) => void) => cb(null)),
        on: jest.fn(),
        disconnect: jest.fn(),
      };
      mockRedisClient.duplicate.mockReturnValueOnce(duplicated);

      const handler = jest.fn();
      const sub = service.subscribe('my-channel', handler);

      expect(duplicated.subscribe).toHaveBeenCalledWith('my-channel', expect.any(Function));

      const messageHandler = duplicated.on.mock.calls.find(([event]) => event === 'message')?.[1];
      messageHandler?.('my-channel', 'payload');
      expect(handler).toHaveBeenCalledWith('payload');

      messageHandler?.('other-channel', 'ignored');
      expect(handler).toHaveBeenCalledTimes(1);

      sub.unsubscribe();
      expect(duplicated.disconnect).toHaveBeenCalled();
    });
  });
});
