import { Inject, Injectable } from '@nestjs/common';
import { TournamentType } from '@prisma/client';
import { TOURNAMENT_TYPE_STRATEGIES, TournamentTypeStrategy } from './tournament-type-strategy.interface';

@Injectable()
export class TournamentStrategyRegistry {
  private readonly strategiesByType: Map<TournamentType, TournamentTypeStrategy>;

  constructor(
    @Inject(TOURNAMENT_TYPE_STRATEGIES) strategies: TournamentTypeStrategy[],
  ) {
    this.strategiesByType = new Map(strategies.map((s) => [s.type, s]));
  }

  get(type: TournamentType): TournamentTypeStrategy {
    const strategy = this.strategiesByType.get(type);
    if (!strategy) {
      throw new Error(`No TournamentTypeStrategy registered for tournament type "${type}"`);
    }
    return strategy;
  }
}
