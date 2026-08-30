import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { TournamentType, TournamentStatus } from '@prisma/client';
import { TournamentLifecycleService } from './tournament-lifecycle.service';
import { getPrismaMockProvider, prismaMock } from '../test/mocks/prisma.mock';
import { TournamentScoringService } from './tournament-scoring.service';
import { TournamentStrategyRegistry } from './strategies/tournament-strategy.registry';
import type { TournamentTypeStrategy } from './strategies/tournament-type-strategy.interface';

describe('TournamentLifecycleService', () => {
  let service: TournamentLifecycleService;
  let scoringService: jest.Mocked<Pick<TournamentScoringService, 'rankPlayers'>>;
  let strategy: jest.Mocked<TournamentTypeStrategy>;
  let registry: jest.Mocked<Pick<TournamentStrategyRegistry, 'get'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    scoringService = { rankPlayers: jest.fn() };
    strategy = { type: TournamentType.SWISS, onStarted: jest.fn().mockResolvedValue(undefined), onGameEnded: jest.fn() };
    registry = { get: jest.fn().mockReturnValue(strategy) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentLifecycleService,
        getPrismaMockProvider(),
        { provide: TournamentScoringService, useValue: scoringService },
        { provide: TournamentStrategyRegistry, useValue: registry },
      ],
    }).compile();

    service = module.get<TournamentLifecycleService>(TournamentLifecycleService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  it('should start upcoming tournaments', async () => {
    prismaMock.tournament.findMany
      .mockResolvedValueOnce([{ id: 't1', type: TournamentType.ARENA }] as any) // upcoming
      .mockResolvedValueOnce([]); // inProgress

    await service.handleTournamentStatus();

    expect(prismaMock.tournament.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: TournamentStatus.IN_PROGRESS },
    });
  });

  it('delegates the start of a Swiss tournament to its strategy', async () => {
    prismaMock.tournament.findMany
      .mockResolvedValueOnce([{ id: 't1', type: TournamentType.SWISS }] as any) // upcoming
      .mockResolvedValueOnce([]); // inProgress

    await service.handleTournamentStatus();

    expect(registry.get).toHaveBeenCalledWith(TournamentType.SWISS);
    expect(strategy.onStarted).toHaveBeenCalledWith('t1');
  });

  it('logs (not throws) if a strategy fails to start a tournament', async () => {
    prismaMock.tournament.findMany
      .mockResolvedValueOnce([{ id: 't1', type: TournamentType.SWISS }] as any)
      .mockResolvedValueOnce([]);
    strategy.onStarted.mockRejectedValueOnce(new Error('boom'));

    await expect(service.handleTournamentStatus()).resolves.not.toThrow();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('should complete in-progress Arena tournaments and calculate ranks', async () => {
    prismaMock.tournament.findMany
      .mockResolvedValueOnce([]) // upcoming
      .mockResolvedValueOnce([{ id: 't2' }] as any); // inProgress

    await service.handleTournamentStatus();

    expect(prismaMock.tournament.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { status: TournamentStatus.COMPLETED },
    });
    expect(scoringService.rankPlayers).toHaveBeenCalledWith(prismaMock, 't2');
  });

  it('only queries Arena tournaments for time-based completion', async () => {
    prismaMock.tournament.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.handleTournamentStatus();

    expect(prismaMock.tournament.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: TournamentType.ARENA }),
      }),
    );
  });
});
