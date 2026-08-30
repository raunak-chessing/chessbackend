import { TournamentType } from '@prisma/client';
import { TournamentStrategyRegistry } from './tournament-strategy.registry';
import type { TournamentTypeStrategy } from './tournament-type-strategy.interface';

describe('TournamentStrategyRegistry', () => {
  const arena: TournamentTypeStrategy = {
    type: TournamentType.ARENA,
    onStarted: jest.fn(),
    onGameEnded: jest.fn(),
  };
  const swiss: TournamentTypeStrategy = {
    type: TournamentType.SWISS,
    onStarted: jest.fn(),
    onGameEnded: jest.fn(),
  };

  it('resolves the strategy matching a registered type', () => {
    const registry = new TournamentStrategyRegistry([arena, swiss]);
    expect(registry.get(TournamentType.ARENA)).toBe(arena);
    expect(registry.get(TournamentType.SWISS)).toBe(swiss);
  });

  it('throws a clear error for an unregistered type', () => {
    const registry = new TournamentStrategyRegistry([arena]);
    expect(() => registry.get(TournamentType.SWISS)).toThrow(/No TournamentTypeStrategy registered/);
  });
});
