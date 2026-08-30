import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { GameWinner } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService, CacheSubscription } from '../redis/cache.service';
import { TournamentScoringService } from './tournament-scoring.service';
import { TournamentStrategyRegistry } from './strategies/tournament-strategy.registry';

const GAME_EVENTS_CHANNEL = 'gameserver:events';

/**
 * Reacts to game-end events published by the gameserver over Redis pub/sub,
 * scoring the result and delegating any type-specific bookkeeping (Swiss
 * pairing updates, round advancement) to the matching TournamentTypeStrategy.
 */
@Injectable()
export class TournamentEventListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TournamentEventListenerService.name);
  private subscription: CacheSubscription | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly scoringService: TournamentScoringService,
    private readonly strategyRegistry: TournamentStrategyRegistry,
  ) {}

  onModuleInit() {
    this.subscription = this.cacheService.subscribe(GAME_EVENTS_CHANNEL, (message) => {
      void this.handleMessage(message);
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async handleMessage(message: string): Promise<void> {
    try {
      const event = JSON.parse(message);
      if (event.type === 'game_ended' && event.gameId) {
        await this.handleGameEnded(event.gameId, event.winner ?? null);
      }
    } catch (e) {
      this.logger.error('Error processing game_ended event for tournament result recording', e as Error);
    }
  }

  private async handleGameEnded(gameId: string, winner: GameWinner | null): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { tournamentId: true, whitePlayerId: true, blackPlayerId: true },
    });
    if (!game?.tournamentId || !game.blackPlayerId) return;

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: game.tournamentId },
    });
    if (!tournament) return;

    await this.scoringService.recordGameResult(game.tournamentId, game.whitePlayerId, game.blackPlayerId, winner);
    await this.strategyRegistry.get(tournament.type).onGameEnded(game.tournamentId, gameId, winner);
  }
}
