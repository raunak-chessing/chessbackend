import { Test, TestingModule } from '@nestjs/testing';
import { StreamerGateway } from './streamer.gateway';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { RedisService } from '../redis/redis.service';
import { mockRedisService, mockRedisClient } from '../test/mocks/redis.mock';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthenticatedSocket } from '../types';

describe('StreamerGateway', () => {
  let gateway: StreamerGateway;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamerGateway,
        getPrismaMockProvider(),
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    gateway = module.get<StreamerGateway>(StreamerGateway);
    gateway.server = {
      sockets: {
        adapter: { rooms: new Map() }
      },
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as unknown as Server;

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    gateway.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        id: 'client-1',
        handshake: { auth: {}, headers: {} },
        data: {},
        disconnect: jest.fn(),
      };
    });

    it('should disconnect if no token provided', async () => {
      await gateway.handleConnection(mockClient as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should extract token from cookie and disconnect if invalid', async () => {
      mockClient.handshake.headers.cookie = 'better-auth.session-token=inv';
      prismaMock.session.findUnique.mockResolvedValueOnce(null);
      
      await gateway.handleConnection(mockClient as Socket);
      expect(prismaMock.session.findUnique).toHaveBeenCalledWith({ where: { token: 'inv' }, include: { user: true } });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should authenticate user and set data.user if valid token', async () => {
      mockClient.handshake.auth.token = 'valid';
      prismaMock.session.findUnique.mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 10000),
        user: { id: 'u1' }
      } as any);

      await gateway.handleConnection(mockClient as Socket);
      expect(mockClient.data.user).toEqual({ id: 'u1' });
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should catch errors and disconnect', async () => {
      mockClient.handshake.auth.token = 'valid';
      prismaMock.session.findUnique.mockRejectedValueOnce(new Error('DB Error'));

      await gateway.handleConnection(mockClient as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should log disconnection', () => {
      gateway.handleDisconnect({ id: 'c1' } as any);
      expect(Logger.prototype.debug).toHaveBeenCalledWith('Streamer Client disconnected: c1');
    });
  });

  describe('handleJoin', () => {
    it('should return error if no streamerId', async () => {
      const res = await gateway.handleJoin('', {} as any);
      expect(res.status).toBe('error');
    });

    it('should join room, add to redis, and emit initial heatmap', async () => {
      const mockClient = { join: jest.fn(), emit: jest.fn() } as any;
      mockRedisClient.hgetall.mockResolvedValueOnce({ 'e4': '5', 'd4': '2' });
      
      const res = await gateway.handleJoin('s1', mockClient);

      expect(mockClient.join).toHaveBeenCalledWith('stream:s1');
      expect(mockRedisClient.sadd).toHaveBeenCalledWith('active_streamers', 's1');
      expect(mockClient.emit).toHaveBeenCalledWith('streamer:heatmapUpdate', {
        streamerId: 's1',
        heatmap: { 'e4': 5, 'd4': 2 }
      });
      expect(res).toEqual({ status: 'ok', room: 'stream:s1' });
    });
  });

  describe('handleVoteMove', () => {
    it('should do nothing if missing args', async () => {
      await gateway.handleVoteMove('', 'e4', {} as any);
      await gateway.handleVoteMove('s1', '', {} as any);
      expect(mockRedisClient.sadd).not.toHaveBeenCalled();
    });

    it('should increment heatmap in redis', async () => {
      await gateway.handleVoteMove('s1', 'e4', {} as any);
      expect(mockRedisClient.sadd).toHaveBeenCalledWith('active_streamers', 's1');
      expect(mockRedisClient.hincrby).toHaveBeenCalledWith('streamer_heatmap:s1', 'e4', 1);
    });
  });

  describe('broadcastHeatmaps (interval)', () => {
    it('should fetch active streamers and broadcast to local rooms', async () => {
      mockRedisClient.smembers.mockResolvedValueOnce(['s1', 's2']);
      
      // s1 has viewers
      const s1Set = new Set(['client-1']);
      // s2 has no viewers
      const s2Set = new Set();
      const roomsMap = new Map();
      roomsMap.set('stream:s1', s1Set);
      roomsMap.set('stream:s2', s2Set);
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>) = roomsMap;

      mockRedisClient.hgetall.mockResolvedValueOnce({ 'e4': '10', 'd4': '1' }); // for s1

      // Trigger interval manually by calling the private method
      await (gateway as any).broadcastHeatmaps();

      // Should only process s1 since s2 has no viewers
      expect(mockRedisClient.hgetall).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.hgetall).toHaveBeenCalledWith('streamer_heatmap:s1');

      // Decay updates
      expect(mockRedisClient.hset).toHaveBeenCalledWith('streamer_heatmap:s1', 'e4', 5);
      expect(mockRedisClient.hdel).toHaveBeenCalledWith('streamer_heatmap:s1', 'd4');

      expect(gateway.server.to).toHaveBeenCalledWith('stream:s1');
      expect(gateway.server.emit).toHaveBeenCalledWith('streamer:heatmapUpdate', {
        streamerId: 's1',
        heatmap: { 'e4': 10, 'd4': 1 }
      });
    });

    it('should cleanup active streamers if no votes', async () => {
      mockRedisClient.smembers.mockResolvedValueOnce(['s3']);
      const roomsMap = new Map();
      roomsMap.set('stream:s3', new Set(['client-1']));
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>) = roomsMap;

      mockRedisClient.hgetall.mockResolvedValueOnce({}); // empty heatmap

      await (gateway as any).broadcastHeatmaps();

      expect(mockRedisClient.srem).toHaveBeenCalledWith('active_streamers', 's3');
    });
  });
});
