import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { GameWinner, TournamentType } from '@prisma/client';
import { TournamentEventListenerService } from './tournament-event-listener.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { CacheService } from '../redis/cache.service';
import { TournamentScoringService } from './tournament-scoring.service';
import { TournamentStrategyRegistry } from './strategies/tournament-strategy.registry';
import type { TournamentTypeStrategy } from './strategies/tournament-type-strategy.interface';

describe('TournamentEventListenerService', () => {
  let service: TournamentEventListenerService;
  let cacheService: jest.Mocked<Pick<CacheService, 'subscribe'>>;
  let scoringService: jest.Mocked<Pick<TournamentScoringService, 'recordGameResult'>>;
  let strategy: jest.Mocked<TournamentTypeStrategy>;
  let registry: jest.Mocked<Pick<TournamentStrategyRegistry, 'get'>>;
  let capturedHandler: ((message: string) => void) | undefined;
  const unsubscribe = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedHandler = undefined;

    cacheService = {
      subscribe: jest.fn((_channel, handler) => {
        capturedHandler = handler;
        return { unsubscribe };
      }),
    };
    scoringService = { recordGameResult: jest.fn() };
    strategy = { type: TournamentType.SWISS, onStarted: jest.fn(), onGameEnded: jest.fn() };
    registry = { get: jest.fn().mockReturnValue(strategy) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentEventListenerService,
        getPrismaMockProvider(),
        { provide: CacheService, useValue: cacheService },
        { provide: TournamentScoringService, useValue: scoringService },
        { provide: TournamentStrategyRegistry, useValue: registry },
      ],
    }).compile();

    service = module.get<TournamentEventListenerService>(TournamentEventListenerService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('subscribes to the gameserver events channel on module init', () => {
    service.onModuleInit();
    expect(cacheService.subscribe).toHaveBeenCalledWith('gameserver:events', expect.any(Function));
  });

  it('unsubscribes on module destroy', () => {
    service.onModuleInit();
    service.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does nothing for a module destroy before init', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  describe('handling a message', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('ignores messages that are not game_ended events', async () => {
      capturedHandler?.(JSON.stringify({ type: 'something_else' }));
      await flushMicrotasks();
      expect(prismaMock.game.findUnique).not.toHaveBeenCalled();
    });

    it('logs and swallows unparseable messages', async () => {
      capturedHandler?.('not json');
      await flushMicrotasks();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('does nothing if the game has no tournamentId', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: null, whitePlayerId: 'w', blackPlayerId: 'b' } as any);

      capturedHandler?.(JSON.stringify({ type: 'game_ended', gameId: 'g1', winner: GameWinner.WHITE }));
      await flushMicrotasks();

      expect(prismaMock.tournament.findUnique).not.toHaveBeenCalled();
    });

    it('does nothing for a bye game (no black player)', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: 't1', whitePlayerId: 'w', blackPlayerId: null } as any);

      capturedHandler?.(JSON.stringify({ type: 'game_ended', gameId: 'g1', winner: GameWinner.WHITE }));
      await flushMicrotasks();

      expect(prismaMock.tournament.findUnique).not.toHaveBeenCalled();
    });

    it('records the result and delegates to the matching strategy', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: 't1', whitePlayerId: 'a', blackPlayerId: 'b' } as any);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', type: TournamentType.SWISS } as any);

      capturedHandler?.(JSON.stringify({ type: 'game_ended', gameId: 'g1', winner: GameWinner.WHITE }));
      await flushMicrotasks();

      expect(scoringService.recordGameResult).toHaveBeenCalledWith('t1', 'a', 'b', GameWinner.WHITE);
      expect(registry.get).toHaveBeenCalledWith(TournamentType.SWISS);
      expect(strategy.onGameEnded).toHaveBeenCalledWith('t1', 'g1', GameWinner.WHITE);
    });

    it('defaults a missing winner to null (draw-shaped event)', async () => {
      prismaMock.game.findUnique.mockResolvedValueOnce({ tournamentId: 't1', whitePlayerId: 'a', blackPlayerId: 'b' } as any);
      prismaMock.tournament.findUnique.mockResolvedValueOnce({ id: 't1', type: TournamentType.SWISS } as any);

      capturedHandler?.(JSON.stringify({ type: 'game_ended', gameId: 'g1' }));
      await flushMicrotasks();

      expect(scoringService.recordGameResult).toHaveBeenCalledWith('t1', 'a', 'b', null);
    });
  });
});

// The subscribe handler is invoked without being awaited (mirrors the real
// ioredis 'message' event callback), so tests give pending promises a tick
// to resolve before asserting on their effects.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
