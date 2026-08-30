import { Test, TestingModule } from '@nestjs/testing';
import { PuzzleBattleService } from './puzzle-battle.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { QuestsService } from '../quests/quests.service';
import { FactionsService } from '../factions/factions.service';

describe('PuzzleBattleService', () => {
  let service: PuzzleBattleService;
  let questsService: jest.Mocked<Pick<QuestsService, 'incrementQuestProgress'>>;
  let factionsService: jest.Mocked<Pick<FactionsService, 'incrementFactionScoreForUser'>>;

  const player = (overrides: Partial<Parameters<PuzzleBattleService['joinQueue']>[0]> = {}) => ({
    id: 'p1',
    socketId: 's1',
    score: 0,
    rating: 1200,
    name: 'Alice',
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    questsService = { incrementQuestProgress: jest.fn().mockResolvedValue(undefined) };
    factionsService = { incrementFactionScoreForUser: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PuzzleBattleService,
        getPrismaMockProvider(),
        { provide: QuestsService, useValue: questsService },
        { provide: FactionsService, useValue: factionsService },
      ],
    }).compile();

    service = module.get<PuzzleBattleService>(PuzzleBattleService);
    prismaMock.puzzle.count.mockResolvedValue(10);
    prismaMock.puzzle.findMany.mockResolvedValue([{ id: 'pz1' }] as any);
  });

  describe('joinQueue', () => {
    it('does not match a lone player', async () => {
      const result = await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      expect(result).toEqual({ matched: false });
    });

    it('matches the second player against the first and creates a room', async () => {
      await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      const result = await service.joinQueue(player({ id: 'p2', socketId: 's2', name: 'Bob' }));

      expect(result.matched).toBe(true);
      if (!result.matched) throw new Error('expected a match');
      expect(Object.keys(result.room.players)).toEqual(['s1', 's2']);
      expect(result.room.status).toBe('IN_PROGRESS');
      expect(result.room.roundIndex).toBe(0);
      expect(result.room.puzzles).toEqual([{ id: 'pz1' }]);
    });

    it('drops an existing queue entry for the same player id before re-adding (no double join)', async () => {
      await service.joinQueue(player({ id: 'p1', socketId: 's1-old' }));
      await service.joinQueue(player({ id: 'p1', socketId: 's1-new' }));
      const result = await service.joinQueue(player({ id: 'p2', socketId: 's2' }));

      expect(result.matched).toBe(true);
      if (!result.matched) throw new Error('expected a match');
      // Only the latest socket for p1 should be in the room, not both.
      expect(Object.keys(result.room.players)).toEqual(['s1-new', 's2']);
    });

    it('leaves a third joiner queued after the first two are matched', async () => {
      await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      await service.joinQueue(player({ id: 'p2', socketId: 's2' }));
      const third = await service.joinQueue(player({ id: 'p3', socketId: 's3' }));
      expect(third).toEqual({ matched: false });
    });
  });

  describe('leaveQueue', () => {
    it('removes the player so a later join does not immediately match', async () => {
      await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      service.leaveQueue('s1');
      const result = await service.joinQueue(player({ id: 'p2', socketId: 's2' }));
      expect(result).toEqual({ matched: false });
    });
  });

  describe('isRoomActive / recordPuzzleSolved / handleDisconnect', () => {
    async function createRoom() {
      await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      const result = await service.joinQueue(player({ id: 'p2', socketId: 's2' }));
      if (!result.matched) throw new Error('expected a match');
      return result.room;
    }

    it('isRoomActive is false for an unknown room', () => {
      expect(service.isRoomActive('missing', 's1')).toBe(false);
    });

    it('isRoomActive is true only for a participant of an in-progress room', async () => {
      const room = await createRoom();
      expect(service.isRoomActive(room.id, 's1')).toBe(true);
      expect(service.isRoomActive(room.id, 's3')).toBe(false);
    });

    it('recordPuzzleSolved increments score and reports the round winner', async () => {
      const room = await createRoom();
      const result = service.recordPuzzleSolved(room.id, 's1');
      expect(result).toEqual({ winnerSocketId: 's1', playerScore: 1 });
      expect(result?.battleEnded).toBeUndefined();
    });

    it('ignores a stale solve for a round that has already advanced', async () => {
      const room = await createRoom();
      service.recordPuzzleSolved(room.id, 's1'); // roundIndex 0 -> 1
      const stale = service.recordPuzzleSolved(room.id, 's2', 0);
      expect(stale).toBeNull();
    });

    it('returns null for a room that does not exist', () => {
      expect(service.recordPuzzleSolved('missing', 's1')).toBeNull();
    });

    it('ends the battle, distributes rewards, and schedules room cleanup once a player reaches 3 points', async () => {
      jest.useFakeTimers();
      try {
        const room = await createRoom();
        service.recordPuzzleSolved(room.id, 's1');
        service.recordPuzzleSolved(room.id, 's1');
        const result = service.recordPuzzleSolved(room.id, 's1');

        expect(result?.battleEnded).toEqual({ winnerId: 'p1', loserId: 'p2' });
        expect(questsService.incrementQuestProgress).toHaveBeenCalledWith('p1', 'WIN_PUZZLE_BATTLE');
        expect(questsService.incrementQuestProgress).toHaveBeenCalledWith('p1', 'PLAY_BATTLES');
        expect(questsService.incrementQuestProgress).toHaveBeenCalledWith('p2', 'PLAY_BATTLES');
        expect(factionsService.incrementFactionScoreForUser).toHaveBeenCalledWith('p1', 25);

        // Room stays queryable immediately after the win...
        expect(service.isRoomActive(room.id, 's1')).toBe(false); // FINISHED, not IN_PROGRESS
        jest.advanceTimersByTime(10000);
        // ...and is cleaned up 10s later.
        expect(service.recordPuzzleSolved(room.id, 's1')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not let reward-distribution rejections escape (fire-and-forget)', async () => {
      jest.useFakeTimers();
      try {
        questsService.incrementQuestProgress.mockRejectedValue(new Error('quest service down'));
        const room = await createRoom();

        expect(() => {
          service.recordPuzzleSolved(room.id, 's1');
          service.recordPuzzleSolved(room.id, 's1');
          service.recordPuzzleSolved(room.id, 's1');
        }).not.toThrow();
      } finally {
        jest.useRealTimers();
      }
    });

    it('handleDisconnect finishes an in-progress room and reports it, and clears the room', async () => {
      const room = await createRoom();
      const affected = service.handleDisconnect('s1');

      expect(affected).toEqual([{ roomId: room.id }]);
      expect(service.isRoomActive(room.id, 's2')).toBe(false);
    });

    it('handleDisconnect reports nothing for a socket not in any room', () => {
      expect(service.handleDisconnect('unknown-socket')).toEqual([]);
    });

    it('handleDisconnect also removes the socket from the matchmaking queue', async () => {
      await service.joinQueue(player({ id: 'p1', socketId: 's1' }));
      service.handleDisconnect('s1');
      const result = await service.joinQueue(player({ id: 'p2', socketId: 's2' }));
      expect(result).toEqual({ matched: false });
    });
  });
});
