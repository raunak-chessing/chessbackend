import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus, TournamentType } from '@prisma/client';
import { TournamentScoringService } from './tournament-scoring.service';
import { TournamentStrategyRegistry } from './strategies/tournament-strategy.registry';

/**
 * Advances tournaments through their status lifecycle over time: starts
 * UPCOMING tournaments once their start time arrives (delegating any
 * type-specific "what happens on start" behavior to the matching
 * strategy), and closes out time-boxed Arena tournaments once they expire.
 *
 * Swiss tournaments complete via round-exhaustion (SwissRoundService),
 * not on a timer, so they're intentionally excluded from the second query.
 */
@Injectable()
export class TournamentLifecycleService {
  private readonly logger = new Logger(TournamentLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: TournamentScoringService,
    private readonly strategyRegistry: TournamentStrategyRegistry,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTournamentStatus() {
    const now = new Date();

    const upcoming = await this.prisma.tournament.findMany({
      where: { status: TournamentStatus.UPCOMING, startTime: { lte: now } },
    });
    for (const t of upcoming) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.IN_PROGRESS },
      });
      this.logger.log(`Tournament started: ${t.id}`);

      await this.strategyRegistry
        .get(t.type)
        .onStarted(t.id)
        .catch((e) => this.logger.error(`Failed to start tournament ${t.id}`, e));
    }

    const inProgress = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.IN_PROGRESS,
        endTime: { lte: now },
        type: TournamentType.ARENA,
      },
    });
    for (const t of inProgress) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.COMPLETED },
      });
      this.logger.log(`Tournament ended: ${t.id}`);

      await this.scoringService.rankPlayers(this.prisma, t.id);
    }
  }
}
