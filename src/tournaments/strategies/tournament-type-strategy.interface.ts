import { TournamentType, GameWinner } from '@prisma/client';

export const TOURNAMENT_TYPE_STRATEGIES = Symbol('TOURNAMENT_TYPE_STRATEGIES');

/**
 * Per-tournament-type behavior, selected by TournamentStrategyRegistry.
 *
 * Previously TournamentsService branched on `tournament.type` directly in
 * three separate methods (handleGameEnded, the startNextRound guard, and
 * handleTournamentStatus) — adding a new format meant editing all three
 * with no compiler help to find a missed spot. Adding a new format now
 * means writing one new class and registering it; nothing else changes.
 */
export interface TournamentTypeStrategy {
  readonly type: TournamentType;

  /** Called when the lifecycle cron transitions a tournament to IN_PROGRESS. */
  onStarted(tournamentId: string): Promise<void>;

  /** Called after a game's result has been scored, for any type-specific bookkeeping. */
  onGameEnded(tournamentId: string, gameId: string, winner: GameWinner | null): Promise<void>;
}
