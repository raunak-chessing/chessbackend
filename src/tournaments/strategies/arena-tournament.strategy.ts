import { Injectable } from '@nestjs/common';
import { TournamentType } from '@prisma/client';
import { TournamentTypeStrategy } from './tournament-type-strategy.interface';

/**
 * Arena tournaments have no rounds or pairings — they run for a fixed
 * duration and score every finished game as it happens, so there is no
 * type-specific bookkeeping to do on start or on game-end.
 */
@Injectable()
export class ArenaTournamentStrategy implements TournamentTypeStrategy {
  readonly type = TournamentType.ARENA;

  async onStarted(): Promise<void> {
    // No rounds to kick off.
  }

  async onGameEnded(): Promise<void> {
    // Scoring already happened in TournamentScoringService; nothing else to do.
  }
}
