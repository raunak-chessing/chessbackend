import { Test, TestingModule } from '@nestjs/testing';
import { PuzzleBattleGateway } from './puzzle-battle.gateway';
import { PuzzleBattleService } from './puzzle-battle.service';
import { WsAuthService } from '../common/ws-auth.service';
import { CacheService } from '../redis/cache.service';

describe('PuzzleBattleGateway', () => {
  let gateway: PuzzleBattleGateway;
  let wsAuthService: jest.Mocked<Pick<WsAuthService, 'resolveUser'>>;
  let cacheService: jest.Mocked<Pick<CacheService, 'checkRateLimit'>>;
  let puzzleBattleService: jest.Mocked<
    Pick<PuzzleBattleService, 'joinQueue' | 'leaveQueue' | 'isRoomActive' | 'recordPuzzleSolved' | 'handleDisconnect'>
  >;

  beforeEach(async () => {
    jest.clearAllMocks();
    wsAuthService = { resolveUser: jest.fn() };
    cacheService = { checkRateLimit: jest.fn().mockResolvedValue(true) };
    puzzleBattleService = {
      joinQueue: jest.fn(),
      leaveQueue: jest.fn(),
      isRoomActive: jest.fn(),
      recordPuzzleSolved: jest.fn(),
      handleDisconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PuzzleBattleGateway,
        { provide: WsAuthService, useValue: wsAuthService },
        { provide: CacheService, useValue: cacheService },
        { provide: PuzzleBattleService, useValue: puzzleBattleService },
      ],
    }).compile();

    gateway = module.get<PuzzleBattleGateway>(PuzzleBattleGateway);
    gateway.server = { to: jest.fn().mockReturnThis(), emit: jest.fn(), fetchSockets: jest.fn() } as any;
  });

  describe('handleConnection', () => {
    it('uses the resolved user when authenticated', async () => {
      const user = { id: 'u1', name: 'Alice', email: 'a@b.com' };
      wsAuthService.resolveUser.mockResolvedValueOnce(user as any);
      const client: any = { data: {} };

      await gateway.handleConnection(client);

      expect(client.data.user).toBe(user);
    });

    it('falls back to a guest identity when unauthenticated', async () => {
      wsAuthService.resolveUser.mockResolvedValueOnce(null);
      const client: any = { id: 'sock-123', data: {} };

      await gateway.handleConnection(client);

      expect(client.data.user).toMatchObject({
        name: 'Guest-sock-',
        email: 'guest@chess.local',
        ratingPuzzle: 1200,
      });
    });
  });

  it('handleDisconnect broadcasts opponentDisconnected for every room the service reports', () => {
    puzzleBattleService.handleDisconnect.mockReturnValueOnce([{ roomId: 'r1' }, { roomId: 'r2' }]);
    gateway.handleDisconnect({ id: 's1' } as any);

    expect(gateway.server.to).toHaveBeenCalledWith('r1');
    expect(gateway.server.to).toHaveBeenCalledWith('r2');
    expect(gateway.server.emit).toHaveBeenCalledWith('opponentDisconnected');
  });

  describe('handleJoinQueue', () => {
    it('rejects a player flagged for cheating without joining the queue', async () => {
      const client: any = { id: 's1', data: { user: { isFlaggedForCheating: true } }, emit: jest.fn() };
      await gateway.handleJoinQueue(client);

      expect(client.emit).toHaveBeenCalledWith('queueError', expect.any(Object));
      expect(puzzleBattleService.joinQueue).not.toHaveBeenCalled();
    });

    it('does nothing further when not yet matched', async () => {
      puzzleBattleService.joinQueue.mockResolvedValueOnce({ matched: false });
      const client: any = { id: 's1', data: { user: { id: 'u1', name: 'Alice', ratingPuzzle: 1400 } } };

      await gateway.handleJoinQueue(client);

      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it('joins both matched sockets to the room and emits matchFound', async () => {
      const room = {
        id: 'r1',
        puzzles: [],
        status: 'IN_PROGRESS' as const,
        roundIndex: 0,
        players: {
          s1: { id: 'u1', socketId: 's1', score: 0, rating: 1200, name: 'Alice' },
          s2: { id: 'u2', socketId: 's2', score: 0, rating: 1300, name: 'Bob' },
        },
      };
      puzzleBattleService.joinQueue.mockResolvedValueOnce({ matched: true, room });

      const s1 = { id: 's1', join: jest.fn() };
      const s2 = { id: 's2', join: jest.fn() };
      (gateway.server.fetchSockets as jest.Mock).mockResolvedValueOnce([s1, s2]);

      const client: any = { id: 's1', data: { user: { id: 'u1', name: 'Alice', ratingPuzzle: 1200 } } };
      await gateway.handleJoinQueue(client);

      expect(s1.join).toHaveBeenCalledWith('r1');
      expect(s2.join).toHaveBeenCalledWith('r1');
      expect(gateway.server.to).toHaveBeenCalledWith('r1');
      expect(gateway.server.emit).toHaveBeenCalledWith('matchFound', expect.objectContaining({ roomId: 'r1' }));
    });
  });

  describe('handleMakeMove', () => {
    it('drops the move when rate-limited', async () => {
      cacheService.checkRateLimit.mockResolvedValueOnce(false);
      const client: any = { id: 's1', to: jest.fn() };

      await gateway.handleMakeMove({ roomId: 'r1', source: 'e2', target: 'e4', fen: 'fen' }, client);

      expect(puzzleBattleService.isRoomActive).not.toHaveBeenCalled();
    });

    it('relays the move to the room when active', async () => {
      puzzleBattleService.isRoomActive.mockReturnValueOnce(true);
      const emit = jest.fn();
      const client: any = { id: 's1', to: jest.fn().mockReturnValue({ emit }) };

      await gateway.handleMakeMove({ roomId: 'r1', source: 'e2', target: 'e4', fen: 'fen' }, client);

      expect(client.to).toHaveBeenCalledWith('r1');
      expect(emit).toHaveBeenCalledWith('opponentMove', { source: 'e2', target: 'e4', fen: 'fen' });
    });
  });

  describe('handlePuzzleSolved', () => {
    it('does nothing when the service reports no result', () => {
      puzzleBattleService.recordPuzzleSolved.mockReturnValueOnce(null);
      gateway.handlePuzzleSolved({ roomId: 'r1', timeMs: 100 }, { id: 's1' } as any);
      expect(gateway.server.emit).not.toHaveBeenCalled();
    });

    it('emits roundWon, and battleEnded only when the service reports one', () => {
      puzzleBattleService.recordPuzzleSolved.mockReturnValueOnce({ winnerSocketId: 's1', playerScore: 1 });
      gateway.handlePuzzleSolved({ roomId: 'r1', timeMs: 100 }, { id: 's1' } as any);

      expect(gateway.server.emit).toHaveBeenCalledWith('roundWon', expect.objectContaining({ winnerSocketId: 's1' }));
      expect(gateway.server.emit).not.toHaveBeenCalledWith('battleEnded', expect.anything());
    });

    it('also emits battleEnded when the battle concludes', () => {
      puzzleBattleService.recordPuzzleSolved.mockReturnValueOnce({
        winnerSocketId: 's1',
        playerScore: 3,
        battleEnded: { winnerId: 'u1', loserId: 'u2' },
      });
      gateway.handlePuzzleSolved({ roomId: 'r1', timeMs: 100 }, { id: 's1' } as any);

      expect(gateway.server.emit).toHaveBeenCalledWith(
        'battleEnded',
        expect.objectContaining({ winnerId: 'u1', reason: 'score_reached' }),
      );
    });
  });
});
