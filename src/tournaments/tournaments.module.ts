import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { SwissPairingService } from './swiss-pairing.service';
import { TournamentScoringService } from './tournament-scoring.service';
import { SwissRoundService } from './swiss-round.service';
import { TournamentEventListenerService } from './tournament-event-listener.service';
import { TournamentLifecycleService } from './tournament-lifecycle.service';
import { ArenaTournamentStrategy } from './strategies/arena-tournament.strategy';
import { SwissTournamentStrategy } from './strategies/swiss-tournament.strategy';
import { TournamentStrategyRegistry } from './strategies/tournament-strategy.registry';
import { TOURNAMENT_TYPE_STRATEGIES } from './strategies/tournament-type-strategy.interface';

import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [TournamentsController],
  providers: [
    TournamentsService,
    SwissPairingService,
    TournamentScoringService,
    SwissRoundService,
    TournamentEventListenerService,
    TournamentLifecycleService,
    ArenaTournamentStrategy,
    SwissTournamentStrategy,
    TournamentStrategyRegistry,
    {
      provide: TOURNAMENT_TYPE_STRATEGIES,
      useFactory: (arena: ArenaTournamentStrategy, swiss: SwissTournamentStrategy) => [arena, swiss],
      inject: [ArenaTournamentStrategy, SwissTournamentStrategy],
    },
  ],
  exports: [TournamentsService],
})
export class TournamentsModule {}
