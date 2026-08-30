import { Test, TestingModule } from '@nestjs/testing';
import { StreamerGateway } from './streamer.gateway';
import { WsAuthService } from '../common/ws-auth.service';
import { CacheService } from '../redis/cache.service';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

describe('StreamerGateway', () => {
  let gateway: StreamerGateway;
  let wsAuthService: jest.Mocked<Pick<WsAuthService, 'resolveUser'>>;
  let cacheService: jest.Mocked<
    Pick<
      CacheService,
      'addToSet' | 'removeFromSet' | 'getSetMembers' | 'hashGetAll' | 'hashIncrementBy' | 'hashSet' | 'hashDelete'
    >
  >;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    wsAuthService = { resolveUser: jest.fn() };
    cacheService = {
      addToSet: jest.fn(),
      removeFromSet: jest.fn(),
      getSetMembers: jest.fn().mockResolvedValue([]),
      hashGetAll: jest.fn().mockResolvedValue({}),
      hashIncrementBy: jest.fn(),
      hashSet: jest.fn(),
      hashDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreamerGateway,
        { provide: WsAuthService, useValue: wsAuthService },
        { provide: CacheService, useValue: cacheService },
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
      mockClient = { id: 'client-1', data: {}, disconnect: jest.fn() };
    });

    it('disconnects an unauthenticated client', async () => {
      wsAuthService.resolveUser.mockResolvedValueOnce(null);
      await gateway.handleConnection(mockClient as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('authenticates and sets data.user for a valid session', async () => {
      const user = { id: 'u1' };
      wsAuthService.resolveUser.mockResolvedValueOnce(user as any);

      await gateway.handleConnection(mockClient as Socket);

      expect(mockClient.data.user).toEqual(user);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
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

    it('should join room, add to the active-streamers set, and emit the initial heatmap', async () => {
      const mockClient = { join: jest.fn(), emit: jest.fn() } as any;
      cacheService.hashGetAll.mockResolvedValueOnce({ e4: '5', d4: '2' });

      const res = await gateway.handleJoin('s1', mockClient);

      expect(mockClient.join).toHaveBeenCalledWith('stream:s1');
      expect(cacheService.addToSet).toHaveBeenCalledWith('active_streamers', 's1');
      expect(mockClient.emit).toHaveBeenCalledWith('streamer:heatmapUpdate', {
        streamerId: 's1',
        heatmap: { e4: 5, d4: 2 }
      });
      expect(res).toEqual({ status: 'ok', room: 'stream:s1' });
    });
  });

  describe('handleVoteMove', () => {
    it('should do nothing if missing args', async () => {
      await gateway.handleVoteMove('', 'e4', {} as any);
      await gateway.handleVoteMove('s1', '', {} as any);
      expect(cacheService.addToSet).not.toHaveBeenCalled();
    });

    it('should increment heatmap in redis', async () => {
      await gateway.handleVoteMove('s1', 'e4', {} as any);
      expect(cacheService.addToSet).toHaveBeenCalledWith('active_streamers', 's1');
      expect(cacheService.hashIncrementBy).toHaveBeenCalledWith('streamer_heatmap:s1', 'e4', 1);
    });
  });

  describe('broadcastHeatmaps (interval)', () => {
    it('should fetch active streamers and broadcast to local rooms', async () => {
      cacheService.getSetMembers.mockResolvedValueOnce(['s1', 's2']);

      // s1 has viewers
      const s1Set = new Set(['client-1']);
      // s2 has no viewers
      const s2Set = new Set();
      const roomsMap = new Map();
      roomsMap.set('stream:s1', s1Set);
      roomsMap.set('stream:s2', s2Set);
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>) = roomsMap;

      cacheService.hashGetAll.mockResolvedValueOnce({ e4: '10', d4: '1' }); // for s1

      // Trigger interval manually by calling the private method
      await (gateway as any).broadcastHeatmaps();

      // Should only process s1 since s2 has no viewers
      expect(cacheService.hashGetAll).toHaveBeenCalledTimes(1);
      expect(cacheService.hashGetAll).toHaveBeenCalledWith('streamer_heatmap:s1');

      // Decay updates
      expect(cacheService.hashSet).toHaveBeenCalledWith('streamer_heatmap:s1', 'e4', '5');
      expect(cacheService.hashDelete).toHaveBeenCalledWith('streamer_heatmap:s1', 'd4');

      expect(gateway.server.to).toHaveBeenCalledWith('stream:s1');
      expect(gateway.server.emit).toHaveBeenCalledWith('streamer:heatmapUpdate', {
        streamerId: 's1',
        heatmap: { e4: 10, d4: 1 }
      });
    });

    it('should cleanup active streamers if no votes', async () => {
      cacheService.getSetMembers.mockResolvedValueOnce(['s3']);
      const roomsMap = new Map();
      roomsMap.set('stream:s3', new Set(['client-1']));
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>) = roomsMap;

      cacheService.hashGetAll.mockResolvedValueOnce({}); // empty heatmap

      await (gateway as any).broadcastHeatmaps();

      expect(cacheService.removeFromSet).toHaveBeenCalledWith('active_streamers', 's3');
    });
  });
});
