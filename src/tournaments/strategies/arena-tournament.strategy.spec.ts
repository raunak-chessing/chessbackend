import { TournamentType } from '@prisma/client';
import { ArenaTournamentStrategy } from './arena-tournament.strategy';

describe('ArenaTournamentStrategy', () => {
  const strategy = new ArenaTournamentStrategy();

  it('declares its type as ARENA', () => {
    expect(strategy.type).toBe(TournamentType.ARENA);
  });

  it('has nothing to do on start or on game-end (no rounds, no pairings)', async () => {
    await expect(strategy.onStarted()).resolves.toBeUndefined();
    await expect(strategy.onGameEnded()).resolves.toBeUndefined();
  });
});
